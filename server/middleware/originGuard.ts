import type { MiddlewareHandler } from "hono";
import { HttpError } from "../exceptions/HttpError.ts";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * ÉCHEC FERMÉ (CSRF) : une requête qui modifie quelque chose doit porter l'en-tête `Origin` exact de
 * l'application. Une requête SANS `Origin` est refusée aussi : seule notre application appelle ces
 * routes, depuis un navigateur, qui pose toujours `Origin` sur un POST `fetch`. C'est plus strict que
 * MaskAI-Frontend (`lib/upstream.ts`), qui laisse passer les clients non navigateurs.
 */
export function originGuard(appOrigin: string): MiddlewareHandler {
  return async (c, next) => {
    if (MUTATING_METHODS.has(c.req.method) && c.req.header("origin") !== appOrigin) {
      throw new HttpError(403, "forbidden_origin", "Cross-origin request refused");
    }
    await next();
  };
}
