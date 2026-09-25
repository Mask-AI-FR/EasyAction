import type { MiddlewareHandler } from "hono";
import { HttpError } from "../exceptions/HttpError.ts";
import { secondFactorStateOf, type TwoFactorStore } from "../services/twoFactor.ts";
import type { SessionVariables } from "./session.ts";

/**
 * Routes de l'API utilisables AVANT le code du jour : exactement ces paires méthode + chemin — une
 * liste fermée, jamais un préfixe (une route ajoutée plus tard est protégée d'office ; un test parcourt
 * toutes les routes). Chacune se protège elle-même : la mise en place ne remplace pas une application
 * déjà confirmée sans un code actuel, et le QR code n'existe que pour un secret en attente.
 */
export const OPEN_BEFORE_SECOND_FACTOR: ReadonlySet<string> = new Set([
  "GET /api/session",
  "POST /api/account/two-factor/enrollment",
  "GET /api/account/two-factor/enrollment/qr.svg",
  "POST /api/account/two-factor/enrollment/confirm",
  "POST /api/account/two-factor/verify",
]);

/**
 * ÉCHEC FERMÉ : toute autre route exige un code à 6 chiffres accepté depuis moins de
 * `TWO_FACTOR_EVERY_HOURS` pour CETTE session → sinon 403 `second_factor_required`, et l'application
 * ouvre la page du code. Posée après `requireSession`, qui fournit la session.
 */
export function requireSecondFactor(store: TwoFactorStore): MiddlewareHandler<{ Variables: SessionVariables }> {
  return async (c, next) => {
    const open = OPEN_BEFORE_SECOND_FACTOR.has(`${c.req.method} ${c.req.path}`);
    if (!open && secondFactorStateOf(store, c.get("session")) !== "verified") {
      throw new HttpError(403, "second_factor_required", "Enter the 6-digit code from your authenticator app");
    }
    await next();
  };
}
