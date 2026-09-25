import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { GitHubApiError } from "../adapters/githubApi.ts";
import { logger } from "../config/logger.ts";
import { renderError } from "../exceptions/errorHandler.ts";
import { HttpError } from "../exceptions/HttpError.ts";
import { deleteSessions, findSession } from "../repositories/sessions.ts";
import type { GitHubTokens, LeaseOptions } from "../services/githubTokens.ts";
import { resolveSession, type ActiveSession, type SessionStore } from "../services/sessions.ts";

/** Variables Hono des routes protégées. */
export interface SessionVariables {
  readonly session: ActiveSession;
  /** Jeton GitHub de la session, renouvelé au besoin. Il ne quitte jamais le serveur. */
  readonly githubToken: (options?: LeaseOptions) => Promise<string>;
}

export interface SessionGuard {
  readonly store: SessionStore;
  readonly tokens: GitHubTokens;
  readonly cookieName: string;
}

/**
 * Exige une session valide. ÉCHEC FERMÉ : cookie absent, inconnu ou session expirée → 401, et
 * l'application renvoie vers la connexion. Les jetons GitHub ne sont lisibles qu'ici, côté serveur.
 */
export function requireSession(guard: SessionGuard): MiddlewareHandler<{ Variables: SessionVariables }> {
  return async (c, next) => {
    const cookie = getCookie(c, guard.cookieName);
    const session = cookie ? resolveSession(guard.store, cookie) : null;
    if (!session) throw new HttpError(401, "unauthorized", "Sign in required");
    let leased = session.tokenGeneration;
    c.set("session", session);
    c.set("githubToken", async (options?: LeaseOptions) => {
      const lease = await guard.tokens.lease(session.idHash, options);
      leased = lease.generation;
      return lease.token;
    });
    guard.tokens.enter(session.idHash);
    try {
      await next();
    } finally {
      guard.tokens.leave(session.idHash);
    }
    // `c.error` : l'erreur levée par la route, déjà rendue par `app.onError` (hono/context.d.ts).
    if (c.error instanceof GitHubApiError && c.error.code === "unauthorized") {
      settleRejectedToken(c, guard.store, session.idHash, leased);
    }
  };
}

/**
 * GitHub a refusé (401) le jeton utilisé par la requête.
 * - C'était le jeton courant : ÉCHEC FERMÉ, la session est fermée (jeton révoqué, autorisation retirée) ;
 *   la réponse reste 401 et l'application renvoie vers la connexion.
 * - La session a été renouvelée PENDANT la requête : GitHub a invalidé l'ancien jeton en émettant le
 *   nouveau. Ce 401 ne dit rien de la session, qui reste ouverte ; la réponse devient 502 « réessayez ».
 */
function settleRejectedToken(c: Context, store: SessionStore, idHash: string, leased: number): void {
  const current = findSession(store.db, idHash);
  if (current && current.tokenGeneration > leased) {
    c.res = renderError(new GitHubApiError("upstream"), c);
    return;
  }
  deleteSessions(store.db, { idHash });
  logger.warn("auth.session_rejected", { route: c.req.routePath, upstream: "github" });
}
