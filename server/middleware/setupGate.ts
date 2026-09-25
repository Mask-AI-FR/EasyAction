import type { MiddlewareHandler } from "hono";
import { HttpError } from "../exceptions/HttpError.ts";

/**
 * Mode installation : tant qu'aucune connexion à GitHub lisible n'est enregistrée (première
 * installation, connexion effacée, secret illisible après un changement de DATA_ENCRYPTION_KEY),
 * seule l'installation fonctionne.
 *
 * ÉCHEC FERMÉ : `/api/*` répond `503 setup_required` (l'app ouvre alors /setup) et `/auth/*` renvoie
 * vers /setup (se connecter avec GitHub est impossible sans app GitHub). Restent ouverts : `/health`
 * (supervision), `/api/setup*` (l'installation, elle-même fermée par un code du serveur) et les pages de
 * l'app, qui se chargent pour afficher /setup.
 */
export function setupGate(isConfigured: () => boolean): MiddlewareHandler {
  return async (c, next) => {
    const path = c.req.path;
    const onApi = path === "/api" || path.startsWith("/api/");
    const onAuth = path === "/auth" || path.startsWith("/auth/");
    const onSetup = path === "/api/setup" || path.startsWith("/api/setup/");
    if ((!onApi && !onAuth) || onSetup || isConfigured()) return next();
    if (onAuth) return c.redirect("/setup", 303);
    throw new HttpError(503, "setup_required", "EasyActions is not set up yet: open /setup");
  };
}
