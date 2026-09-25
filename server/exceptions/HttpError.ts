import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ApiErrorCode } from "../../domain/apiContract.ts";

/**
 * Erreur levée par un gestionnaire de route pour produire une réponse `{ detail: { code, message } }`
 * (rendue par `errorHandler.ts`). `message` doit être un texte à nous, sûr à montrer : jamais le
 * message d'une exception amont, qui peut contenir un corps GitHub ou une donnée personnelle.
 */
export class HttpError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: ApiErrorCode,
    message: string,
    /** Secondes à attendre avant de réessayer (codes bloqués) : corps et en-tête `Retry-After`. */
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "HttpError";
  }
}
