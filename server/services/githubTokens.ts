import { GitHubApiError } from "../adapters/githubApi.ts";
import { GitHubOAuthError, refreshUserToken, revokeToken, type GrantedToken } from "../adapters/githubOAuth.ts";
import type { GitHubSettings } from "../config/env.ts";
import { errorFields, logger } from "../config/logger.ts";
import { HttpError } from "../exceptions/HttpError.ts";
import { deleteSessions, findSession, saveRotatedTokens, type SessionRecord } from "../repositories/sessions.ts";
import { DataCipherError, openValue } from "../security/dataCipher.ts";
import { sealTokens, type FreshTokens, type SessionStore } from "./sessions.ts";

/**
 * Jetons GitHub des sessions : lecture, renouvellement, révocation.
 *
 * GitHub invalide l'ancien jeton d'accès dès qu'on le renouvelle. Un renouvellement pendant qu'une
 * autre requête de la même session utilise l'ancien jeton ferait donc échouer celle-ci. D'où :
 * - un seul renouvellement à la fois par session (les requêtes suivantes attendent le même) ;
 * - renouvellement ANTICIPÉ (moins de 30 min restantes) seulement si aucune autre requête de la
 *   session n'est en cours ; OBLIGATOIRE sous 2 min, ou sous la validité qu'une opération longue exige ;
 * - la génération du jeton, pour qu'un 401 dû à un renouvellement concurrent ne ferme pas la session
 *   (middleware/session.ts).
 * L'état est en mémoire : un seul processus Bun sert Pipliner (contrainte documentée).
 */
export interface TokenLease {
  readonly token: string;
  readonly generation: number;
}

export interface LeaseOptions {
  /** Validité minimale exigée (ms) : le jeton d'une opération longue ne doit pas changer en route. */
  readonly minValidityMs?: number;
}

/** Marges du protocole de renouvellement (pas des limites d'exploitation : rien à régler ici). */
const EARLY_REFRESH_MS = 30 * 60_000;
const FORCED_REFRESH_MS = 2 * 60_000;

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

function sessionEnded(): HttpError {
  return new HttpError(401, "unauthorized", "Your session has ended.");
}

/**
 * Jetons complets, ou `null` : sans expiration ni jeton de rafraîchissement, une session ne peut pas
 * durer (l'app GitHub doit avoir « Expire user authorization tokens » coché).
 */
export function toFreshTokens(granted: GrantedToken): FreshTokens | null {
  const { accessToken, expiresIn, refreshToken, refreshExpiresIn } = granted;
  if (expiresIn === undefined || refreshToken === undefined || refreshExpiresIn === undefined) return null;
  return { accessToken, accessExpiresIn: expiresIn, refreshToken, refreshExpiresIn };
}

export class GitHubTokens {
  private readonly refreshing = new Map<string, Promise<TokenLease>>();
  private readonly inFlight = new Map<string, number>();

  /** `github` : la connexion en vigueur, relue à chaque appel (elle se change sur la page Settings). */
  constructor(
    private readonly store: SessionStore,
    private readonly github: () => GitHubSettings,
  ) {}

  /** Une requête de la session commence (compteur utilisé pour le renouvellement anticipé). */
  enter(idHash: string): void {
    this.inFlight.set(idHash, (this.inFlight.get(idHash) ?? 0) + 1);
  }

  leave(idHash: string): void {
    const remaining = (this.inFlight.get(idHash) ?? 1) - 1;
    if (remaining > 0) this.inFlight.set(idHash, remaining);
    else this.inFlight.delete(idHash);
  }

  /** Jeton d'accès valable de la session, renouvelé au besoin. ÉCHEC FERMÉ si la session n'existe plus. */
  async lease(idHash: string, options: LeaseOptions = {}): Promise<TokenLease> {
    const running = this.refreshing.get(idHash);
    if (running) return running;
    const session = findSession(this.store.db, idHash);
    if (!session) throw sessionEnded();
    const remainingMs = session.accessExpiresAt * 1000 - Date.now();
    const alone = (this.inFlight.get(idHash) ?? 0) <= 1;
    const required = Math.max(FORCED_REFRESH_MS, options.minValidityMs ?? 0);
    if (remainingMs < required || (alone && remainingMs < EARLY_REFRESH_MS)) return this.refresh(session);
    return { token: this.reveal(session, "access"), generation: session.tokenGeneration };
  }

  /**
   * Révoque chez GitHub les jetons de sessions déjà fermées chez nous (ÉCHEC OUVERT, voir
   * `revokeQuietly`). `github` : la connexion qui a délivré ces jetons, si elle vient de changer.
   */
  async revokeEnded(sessions: readonly SessionRecord[], route: string, github?: GitHubSettings): Promise<void> {
    await Promise.all(
      sessions.map(async (session) => {
        const token = this.revealForRevocation(session);
        if (token) await this.revokeQuietly(token, route, github);
      }),
    );
  }

  /**
   * ÉCHEC OUVERT : une révocation qui échoue est journalisée sans bloquer. La session est déjà fermée
   * chez nous, et le jeton d'accès expire de lui-même en 8 heures au plus.
   */
  async revokeQuietly(accessToken: string, route: string, github: GitHubSettings = this.github()): Promise<void> {
    try {
      await revokeToken(github, accessToken);
    } catch (err) {
      if (!(err instanceof GitHubOAuthError)) throw err;
      logger.warn("auth.revoke_failed", { route, upstream: "github", ...errorFields(err) });
    }
  }

  private refresh(session: SessionRecord): Promise<TokenLease> {
    const running = this.refreshing.get(session.idHash);
    if (running) return running;
    const task = this.rotate(session).finally(() => this.refreshing.delete(session.idHash));
    this.refreshing.set(session.idHash, task);
    return task;
  }

  private async rotate(session: SessionRecord): Promise<TokenLease> {
    const fresh = await this.exchange(session);
    const sealed = sealTokens(this.store, session.idHash, fresh, nowSeconds());
    if (!saveRotatedTokens(this.store.db, session.idHash, session.tokenGeneration, sealed)) {
      // Session fermée pendant le renouvellement (déconnexion) : le nouveau jeton ne reste pas actif.
      await this.revokeQuietly(fresh.accessToken, "/api");
      throw sessionEnded();
    }
    logger.info("auth.token_refreshed");
    return { token: fresh.accessToken, generation: session.tokenGeneration + 1 };
  }

  /**
   * Échange le jeton de rafraîchissement.
   * - `refresh_refused` : ÉCHEC FERMÉ — la session est fermée, la personne se reconnecte.
   * - `client_rejected` (secret de l'app faux), `upstream`, `timeout` : la session reste, ce n'est pas
   *   elle qui est en cause ; la requête échoue en 502 et pourra être refaite.
   * - Réponse sans nouveau jeton de rafraîchissement : l'ancien est déjà invalide, la session ne peut
   *   plus durer → fermée, et le jeton d'accès obtenu est révoqué.
   */
  private async exchange(session: SessionRecord): Promise<FreshTokens> {
    const refreshToken = this.reveal(session, "refresh");
    try {
      const granted = await refreshUserToken(this.github(), refreshToken);
      const fresh = toFreshTokens(granted);
      if (fresh) return fresh;
      await this.revokeQuietly(granted.accessToken, "/api");
      throw this.close(session);
    } catch (err) {
      if (!(err instanceof GitHubOAuthError)) throw err;
      logger.warn("auth.refresh_failed", { upstream: "github", errCode: err.code });
      if (err.code === "refresh_refused") throw this.close(session);
      throw new GitHubApiError(err.code === "timeout" ? "timeout" : "upstream");
    }
  }

  /** ÉCHEC FERMÉ : un jeton illisible (clé changée, valeur altérée) ferme la session → reconnexion. */
  private reveal(session: SessionRecord, which: "access" | "refresh"): string {
    try {
      return which === "access"
        ? openValue(this.store.dataKey, "session.access_token", session.idHash, session.accessTokenEnc)
        : openValue(this.store.dataKey, "session.refresh_token", session.idHash, session.refreshTokenEnc);
    } catch (err) {
      if (!(err instanceof DataCipherError)) throw err;
      logger.warn("auth.session_unreadable", errorFields(err));
      throw this.close(session);
    }
  }

  /** Jeton d'une session déjà fermée, ou `null` s'il est illisible : rien à révoquer alors. */
  private revealForRevocation(session: SessionRecord): string | null {
    try {
      return openValue(this.store.dataKey, "session.access_token", session.idHash, session.accessTokenEnc);
    } catch (err) {
      if (err instanceof DataCipherError) return null;
      throw err;
    }
  }

  private close(session: SessionRecord): HttpError {
    deleteSessions(this.store.db, { idHash: session.idHash });
    return sessionEnded();
  }
}
