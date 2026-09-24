import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { openSession, type UserSession } from "../auth/sessionCookie.ts";
import { HttpError } from "../exceptions/HttpError.ts";

/** Variables Hono des routes protégées : la session déchiffrée, jeton GitHub compris. */
export interface SessionVariables {
  readonly session: UserSession;
}

/**
 * Exige une session valide. ÉCHEC FERMÉ : cookie absent, falsifié ou expiré → 401, et l'application
 * renvoie vers la connexion. Le jeton GitHub n'est lisible qu'ici, côté serveur.
 */
export function requireSession(
  key: Uint8Array,
  cookieName: string,
): MiddlewareHandler<{ Variables: SessionVariables }> {
  return async (c, next) => {
    const session = await openSession(getCookie(c, cookieName), key);
    if (!session) throw new HttpError(401, "unauthorized", "Sign in required");
    c.set("session", session);
    await next();
  };
}
