import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ApiErrorBody, ApiErrorCode } from "../../domain/apiContract.ts";
import { GitHubApiError, type GitHubFailure } from "../adapters/githubApi.ts";
import { errorFields, logger } from "../config/logger.ts";
import { HttpError } from "./HttpError.ts";

type ErrorExtras = Omit<ApiErrorBody["detail"], "code" | "message">;

export function errorBody(code: ApiErrorCode, message: string, extras: ErrorExtras = {}): ApiErrorBody {
  return { detail: { code, message, ...extras } };
}

/**
 * Réponse de l'API pour chaque échec GitHub : statut et texte à nous. Un 401 de GitHub (jeton
 * révoqué ou expiré) devient notre 401 : l'application renvoie alors vers la connexion.
 */
const GITHUB_FAILURES: Record<
  GitHubFailure,
  { readonly status: ContentfulStatusCode; readonly code: ApiErrorCode; readonly message: string }
> = {
  unauthorized: { status: 401, code: "unauthorized", message: "Your GitHub session has ended." },
  forbidden: { status: 403, code: "forbidden", message: "GitHub refused access to this resource." },
  sso_required: {
    status: 403,
    code: "sso_required",
    message: "This organization requires SAML single sign-on for the GitHub App.",
  },
  not_found: { status: 404, code: "not_found", message: "Not found on GitHub." },
  rate_limited: { status: 429, code: "rate_limited", message: "GitHub rate limit reached." },
  unprocessable: { status: 422, code: "unprocessable", message: "GitHub rejected the request." },
  upstream: { status: 502, code: "upstream", message: "GitHub did not answer correctly." },
  timeout: { status: 502, code: "upstream", message: "GitHub did not answer in time." },
};

/**
 * Gestionnaire central (`app.onError`). Une erreur inattendue est journalisée par son seul nom/code
 * (jamais l'objet ni son message) et répond un 500 générique : le détail reste côté serveur.
 */
export function renderError(err: Error, c: Context): Response {
  if (err instanceof HttpError) {
    const { retryAfterSeconds } = err;
    if (retryAfterSeconds === undefined) return c.json(errorBody(err.code, err.message), err.status);
    c.header("Retry-After", String(retryAfterSeconds));
    return c.json(errorBody(err.code, err.message, { retryAfterSeconds }), err.status);
  }
  if (err instanceof GitHubApiError) return renderGitHubFailure(err, c);
  if (err instanceof HTTPException) return err.getResponse();
  logger.error("http.unhandled_error", {
    route: c.req.routePath,
    method: c.req.method,
    status: 500,
    ...errorFields(err),
  });
  return c.json(errorBody("internal", "Internal Server Error"), 500);
}

function renderGitHubFailure(err: GitHubApiError, c: Context): Response {
  const failure = GITHUB_FAILURES[err.code];
  logger.warn("github.request_failed", {
    route: c.req.routePath,
    method: c.req.method,
    status: failure.status,
    upstream: "github",
    errCode: err.code,
  });
  const { retryAfterSeconds, ssoUrl } = err.details;
  if (retryAfterSeconds !== undefined) c.header("Retry-After", String(retryAfterSeconds));
  const extras: ErrorExtras = {
    ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
    ...(ssoUrl ? { ssoUrl } : {}),
  };
  return c.json(errorBody(failure.code, failure.message, extras), failure.status);
}

/** Réponse JSON pour une route d'API inconnue (au lieu de la page de l'application). */
export function renderNotFound(c: Context): Response {
  return c.json(errorBody("not_found", "Not Found"), 404);
}
