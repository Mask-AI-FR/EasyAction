import type { GitHubSettings } from "../config/env.ts";
import { TokenGranted, TokenRefused } from "../schemas/github.schema.ts";

/**
 * Adaptateur du cycle de vie OAuth d'une GitHub App : URL d'autorisation, échange du code contre un
 * jeton utilisateur, révocation. C'est le seul module qui appelle `/login/oauth/*` et
 * `/applications/{client_id}/token`. Chaque appel a un délai (`GITHUB_TIMEOUT_MS`) et aucune reprise
 * automatique. Le secret client ne sort jamais de ce module ; aucun corps de réponse n'est journalisé.
 */
export type OAuthFailure = "exchange_refused" | "upstream" | "timeout";

export class GitHubOAuthError extends Error {
  constructor(readonly code: OAuthFailure) {
    super(`GitHub OAuth: ${code}`);
    this.name = "GitHubOAuthError";
  }
}

export interface AuthorizeParams {
  readonly state: string;
  readonly codeChallenge: string;
  readonly redirectUri: string;
}

export interface ExchangeParams {
  readonly code: string;
  readonly codeVerifier: string;
  readonly redirectUri: string;
}

export interface GrantedToken {
  readonly accessToken: string;
  /** Secondes avant expiration ; `undefined` si l'app n'expire pas ses jetons (refusé plus haut). */
  readonly expiresIn: number | undefined;
}

export function authorizeUrl(github: GitHubSettings, params: AuthorizeParams): string {
  const query = new URLSearchParams({
    client_id: github.clientId,
    redirect_uri: params.redirectUri,
    state: params.state,
    code_challenge: params.codeChallenge,
    code_challenge_method: "S256",
    allow_signup: "false",
  });
  return `${github.webUrl}/login/oauth/authorize?${query}`;
}

export async function exchangeCode(
  github: GitHubSettings,
  params: ExchangeParams,
): Promise<GrantedToken> {
  const response = await send(github, `${github.webUrl}/login/oauth/access_token`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: github.clientId,
      client_secret: github.clientSecret,
      code: params.code,
      redirect_uri: params.redirectUri,
      code_verifier: params.codeVerifier,
    }),
  });
  if (!response.ok) throw new GitHubOAuthError("upstream");
  const body: unknown = await response.json().catch(() => null);
  if (TokenRefused.safeParse(body).success) throw new GitHubOAuthError("exchange_refused");
  const granted = TokenGranted.safeParse(body);
  if (!granted.success) throw new GitHubOAuthError("upstream");
  return { accessToken: granted.data.access_token, expiresIn: granted.data.expires_in };
}

/**
 * Révoque un jeton utilisateur. Authentification Basic avec l'identifiant et le secret de l'app : le
 * comportement historique documenté de `/applications/{client_id}/token` (la page actuelle de GitHub
 * ne le redit pas ; à confirmer au premier essai réel — un échec est journalisé, sans bloquer).
 */
export async function revokeToken(github: GitHubSettings, accessToken: string): Promise<void> {
  const credentials = btoa(`${github.clientId}:${github.clientSecret}`);
  const response = await send(
    github,
    `${github.apiUrl}/applications/${encodeURIComponent(github.clientId)}/token`,
    {
      method: "DELETE",
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ access_token: accessToken }),
    },
  );
  if (response.status !== 204) throw new GitHubOAuthError("upstream");
}

async function send(github: GitHubSettings, url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(github.timeoutMs) });
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new GitHubOAuthError("timeout");
    }
    if (err instanceof TypeError) throw new GitHubOAuthError("upstream");
    throw err;
  }
}
