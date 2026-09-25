import { createHash } from "node:crypto";
import { SQLiteError, type Database } from "bun:sqlite";
import type { AccountRole } from "../../domain/accountContract.ts";
import type { AuditAction } from "../../domain/auditActions.ts";
import { randomToken } from "../auth/pkce.ts";
import type { SessionPolicy } from "../config/env.ts";
import { errorFields, logger } from "../config/logger.ts";
import { deleteAuditEventsBefore, recordAuditEvent } from "../repositories/auditEvents.ts";
import {
  deleteSessions,
  findSession,
  insertSession,
  markSessionSeen,
  type SealedTokens,
  type SessionRecord,
  type SessionSelection,
} from "../repositories/sessions.ts";
import { findUser, upsertSignedInUser } from "../repositories/users.ts";
import { openValue, sealValue } from "../security/dataCipher.ts";

/**
 * Sessions « rester connecté » : une connexion GitHub ouvre une session en base pour
 * `SESSION_MAX_DAYS` jours ; le cookie n'en porte qu'un identifiant aléatoire (la base n'en garde que
 * le SHA-256), et les jetons GitHub y sont chiffrés. Le renouvellement des jetons vit dans
 * `githubTokens.ts`.
 */
export interface SessionStore {
  readonly db: Database;
  /** Clé des valeurs chiffrées en base (`deriveDataKey(DATA_ENCRYPTION_KEY)`). */
  readonly dataKey: Uint8Array;
  readonly policy: SessionPolicy;
  readonly auditRetentionDays: number;
}

/** Jetons rendus par GitHub (connexion ou renouvellement) ; durées en secondes. */
export interface FreshTokens {
  readonly accessToken: string;
  readonly accessExpiresIn: number;
  readonly refreshToken: string;
  readonly refreshExpiresIn: number;
}

/** Session active telle que les routes la voient : identité et échéances, jamais un jeton. */
export interface ActiveSession {
  readonly idHash: string;
  readonly userId: number;
  readonly login: string;
  readonly avatarUrl: string;
  readonly role: AccountRole;
  /** Secondes depuis l'époque Unix (UTC). */
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly tokenGeneration: number;
  /** Dernier code à 6 chiffres accepté pour cette session, ou `null`. */
  readonly secondFactorAt: number | null;
}

export interface OpenedSession {
  /** Valeur du cookie : n'existe nulle part ailleurs (la base n'en garde que le haché). */
  readonly cookieValue: string;
  readonly maxAgeSeconds: number;
  /** Sessions fermées au passage (ancienne session de ce navigateur, plafond dépassé) : à révoquer. */
  readonly ended: readonly SessionRecord[];
}

const DAY_SECONDS = 86_400;
/** `last_seen_at` n'est réécrit qu'une fois par minute au plus : une écriture par requête serait du bruit. */
const SEEN_EVERY_SECONDS = 60;

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

function hashSessionId(cookieValue: string): string {
  return createHash("sha256").update(cookieValue).digest("base64url");
}

/** Jetons chiffrés pour la ligne `idHash` : grâce à l'AAD, ils ne se déchiffrent dans aucune autre. */
export function sealTokens(store: SessionStore, idHash: string, tokens: FreshTokens, now: number): SealedTokens {
  return {
    accessTokenEnc: sealValue(store.dataKey, "session.access_token", idHash, tokens.accessToken),
    accessExpiresAt: now + tokens.accessExpiresIn,
    refreshTokenEnc: sealValue(store.dataKey, "session.refresh_token", idHash, tokens.refreshToken),
    refreshExpiresAt: now + tokens.refreshExpiresIn,
  };
}

/**
 * Ouvre une session après une connexion GitHub réussie, en UNE transaction : la personne (créée ou
 * mise à jour), la session, le plafond `SESSIONS_PER_USER_MAX` et l'historique. L'ancienne session de
 * ce navigateur est fermée : un cookie ne désigne jamais deux sessions.
 */
export function openSession(
  store: SessionStore,
  owner: { readonly id: number; readonly login: string; readonly avatarUrl: string },
  tokens: FreshTokens,
  previousCookie: string | undefined,
): OpenedSession {
  const now = nowSeconds();
  const cookieValue = randomToken();
  const idHash = hashSessionId(cookieValue);
  const expiresAt = Math.min(now + store.policy.maxDays * DAY_SECONDS, now + tokens.refreshExpiresIn);
  const session: SessionRecord = {
    idHash,
    userId: owner.id,
    createdAt: now,
    lastSeenAt: now,
    expiresAt,
    tokenGeneration: 1,
    secondFactorAt: null,
    ...sealTokens(store, idHash, tokens, now),
  };
  const ended = store.db.transaction(() => {
    upsertSignedInUser(store.db, owner, now);
    const replaced = previousCookie ? deleteSessions(store.db, { idHash: hashSessionId(previousCookie) }) : [];
    insertSession(store.db, session);
    const trimmed = deleteSessions(store.db, { userId: owner.id, keepNewest: store.policy.perUserMax });
    recordAuditEvent(store.db, { action: "session.create", actorId: owner.id, targetId: null }, now);
    return [...replaced, ...trimmed];
  })();
  purgeExpiredData(store.db, store.auditRetentionDays);
  return { cookieValue, maxAgeSeconds: expiresAt - now, ended };
}

/** La session du cookie. ÉCHEC FERMÉ : inconnue ou expirée → `null` (401) ; une session expirée est effacée. */
export function resolveSession(store: SessionStore, cookieValue: string): ActiveSession | null {
  const now = nowSeconds();
  const idHash = hashSessionId(cookieValue);
  const session = findSession(store.db, idHash);
  if (!session) return null;
  const user = findUser(store.db, session.userId);
  if (!user || session.expiresAt <= now) {
    deleteSessions(store.db, { idHash });
    return null;
  }
  if (now - session.lastSeenAt >= SEEN_EVERY_SECONDS) markSessionSeen(store.db, idHash, now);
  return {
    idHash,
    userId: user.id,
    login: user.login,
    avatarUrl: user.avatarUrl,
    role: user.role,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    tokenGeneration: session.tokenGeneration,
    secondFactorAt: session.secondFactorAt,
  };
}

/**
 * Code à 6 chiffres accepté : la session reçoit un NOUVEL identifiant (le cookie d'avant ne vaut plus
 * rien — pas de fixation de session, OWASP) et l'heure du code. Ses jetons sont rechiffrés pour la
 * nouvelle ligne, leur AAD portant l'identifiant. Rend le nouveau cookie, ou `null` si la session
 * n'existe plus. Un jeton illisible lève `DataCipherError` (l'appelant ferme la session).
 */
export function elevateSession(store: SessionStore, idHash: string): Omit<OpenedSession, "ended"> | null {
  const now = nowSeconds();
  const session = findSession(store.db, idHash);
  if (!session) return null;
  const cookieValue = randomToken();
  const nextHash = hashSessionId(cookieValue);
  const reseal = (purpose: "session.access_token" | "session.refresh_token", sealed: string) =>
    sealValue(store.dataKey, purpose, nextHash, openValue(store.dataKey, purpose, idHash, sealed));
  const elevated: SessionRecord = {
    ...session,
    idHash: nextHash,
    secondFactorAt: now,
    accessTokenEnc: reseal("session.access_token", session.accessTokenEnc),
    refreshTokenEnc: reseal("session.refresh_token", session.refreshTokenEnc),
  };
  store.db.transaction(() => {
    deleteSessions(store.db, { idHash });
    insertSession(store.db, elevated);
  })();
  return { cookieValue, maxAgeSeconds: session.expiresAt - now };
}

/**
 * Ferme des sessions et l'inscrit à l'historique, dans la même transaction (si l'historique échoue,
 * rien n'est fermé). Rend les sessions fermées : leurs jetons GitHub sont à révoquer.
 */
export function endSessions(
  store: SessionStore,
  selection: SessionSelection,
  audit: { readonly action: AuditAction; readonly actorId: number; readonly targetId?: number },
): SessionRecord[] {
  return store.db.transaction(() => {
    const ended = deleteSessions(store.db, selection);
    recordAuditEvent(store.db, { ...audit, targetId: audit.targetId ?? null }, nowSeconds());
    return ended;
  })();
}

/**
 * Efface les sessions expirées et l'historique plus vieux que `AUDIT_RETENTION_DAYS`. Lancée au
 * démarrage et à chaque connexion — pas de minuterie, que `bun --hot` empilerait.
 * ÉCHEC OUVERT : un échec est journalisé et la purge réessaie à l'occasion suivante ; en attendant,
 * ces données n'ouvrent aucun accès (une session expirée est refusée à la lecture).
 */
export function purgeExpiredData(db: Database, auditRetentionDays: number): void {
  const now = nowSeconds();
  try {
    db.transaction(() => {
      deleteSessions(db, { expiredAt: now });
      deleteAuditEventsBefore(db, now - auditRetentionDays * DAY_SECONDS);
    })();
  } catch (err) {
    if (!(err instanceof SQLiteError)) throw err;
    logger.warn("db.purge_failed", errorFields(err));
  }
}
