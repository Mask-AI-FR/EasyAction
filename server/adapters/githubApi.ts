import type { z } from "zod";
import type { GitHubSettings } from "../config/env.ts";

/**
 * Couche HTTP commune des adaptateurs de l'API GitHub (`githubRepos.ts`, `githubActions.ts`), appelée
 * au nom de l'utilisateur (jeton `ghu_…`). Ensemble, ces trois modules sont le seul chemin vers
 * `GITHUB_API_URL`. Chaque appel a un délai et AUCUNE reprise automatique ; les réponses sont validées
 * par zod ; les messages et corps de GitHub ne sortent jamais d'ici (seul un code d'échec stable remonte).
 */
export type GitHubFailure =
  | "unauthorized"
  | "forbidden"
  | "sso_required"
  | "not_found"
  | "rate_limited"
  | "unprocessable"
  | "upstream"
  | "timeout";

export interface GitHubFailureDetails {
  /** Secondes à attendre avant de réessayer (limite de débit). */
  readonly retryAfterSeconds?: number;
  /** Page d'autorisation SSO de l'organisation (en-tête `X-GitHub-SSO`). */
  readonly ssoUrl?: string;
}

export class GitHubApiError extends Error {
  constructor(
    readonly code: GitHubFailure,
    readonly details: GitHubFailureDetails = {},
  ) {
    super(`GitHub API: ${code}`);
    this.name = "GitHubApiError";
  }
}

/** Un dépôt désigné par son propriétaire et son nom, déjà validés. */
export interface RepoPath {
  readonly owner: string;
  readonly repo: string;
}

/** Valide une réponse ; un écart de forme devient `upstream`, jamais un `undefined` qui se propage. */
export function parsed<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw new GitHubApiError("upstream");
  return result.data;
}

/** Parcourt les pages d'une liste en suivant l'en-tête `Link: <…>; rel="next"`. */
export async function* pages(github: GitHubSettings, token: string, path: string): AsyncGenerator<unknown> {
  let url: string | null = `${github.apiUrl}${path}`;
  while (url) {
    const response = await send(github, token, url);
    yield await response.json().catch(() => null);
    url = nextPage(response.headers.get("link"), github.apiUrl);
  }
}

/** Adresse de la page suivante, uniquement si elle reste chez NOTRE GitHub : le jeton n'en sort pas. */
function nextPage(link: string | null, apiUrl: string): string | null {
  const next = link ? /<([^>]+)>;\s*rel="next"/.exec(link)?.[1] : undefined;
  if (!next) return null;
  try {
    return new URL(next).origin === new URL(apiUrl).origin ? next : null;
  } catch {
    return null;
  }
}

export interface RequestOptions {
  readonly method?: "GET" | "POST";
  readonly body?: unknown;
}

/** Envoie une requête authentifiée ; lève `timeout`/`upstream` si GitHub ne répond pas. Statut non vérifié. */
export async function request(
  github: GitHubSettings,
  token: string,
  url: string,
  options: RequestOptions = {},
): Promise<Response> {
  try {
    return await fetch(url, {
      method: options.method ?? "GET",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(github.timeoutMs),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new GitHubApiError("timeout");
    }
    if (err instanceof TypeError) throw new GitHubApiError("upstream");
    throw err;
  }
}

/** Comme `request`, mais un statut d'échec devient une `GitHubApiError`. */
export async function send(
  github: GitHubSettings,
  token: string,
  url: string,
  options: RequestOptions = {},
): Promise<Response> {
  const response = await request(github, token, url, options);
  if (!response.ok) throw failureOf(response);
  return response;
}

/** Traduit un statut GitHub en code d'échec stable, sans jamais lire ni recopier le corps. */
export function failureOf(response: Response): GitHubApiError {
  const { status, headers } = response;
  const retryAfter = Number(headers.get("retry-after"));
  const rateLimited =
    status === 429 ||
    (status === 403 && (headers.get("x-ratelimit-remaining") === "0" || retryAfter > 0));
  if (rateLimited) {
    const reset = Number(headers.get("x-ratelimit-reset"));
    const wait = retryAfter > 0 ? retryAfter : Math.max(0, reset - Math.floor(Date.now() / 1000));
    return new GitHubApiError("rate_limited", { retryAfterSeconds: wait });
  }
  if (status === 401) return new GitHubApiError("unauthorized");
  if (status === 403) {
    const ssoUrl = /url=(\S+)/.exec(headers.get("x-github-sso") ?? "")?.[1];
    return ssoUrl ? new GitHubApiError("sso_required", { ssoUrl }) : new GitHubApiError("forbidden");
  }
  if (status === 404) return new GitHubApiError("not_found");
  if (status === 422) return new GitHubApiError("unprocessable");
  return new GitHubApiError("upstream");
}
