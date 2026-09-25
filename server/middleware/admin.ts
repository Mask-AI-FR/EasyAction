import type { MiddlewareHandler } from "hono";
import { HttpError } from "../exceptions/HttpError.ts";
import type { SessionVariables } from "./session.ts";

/**
 * ÉCHEC FERMÉ : `/api/admin/*` est réservé aux administrateurs (rôle en base, donné par
 * `bun run users:promote` puis par d'autres administrateurs) → sinon 403. Posée dans `apiRouter`
 * après la session et le code du jour, une seule fois pour tout `/api/admin/*`.
 */
export const requireAdmin: MiddlewareHandler<{ Variables: SessionVariables }> = async (c, next) => {
  if (c.get("session").role !== "admin") throw new HttpError(403, "forbidden", "Administrators only");
  await next();
};
