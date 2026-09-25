import type { GitHubSettings } from "../config/env.ts";
import { TokenGranted, TokenRefused } from "../schemas/github.schema.ts";

/**
 * Adaptateur du cycle de vie OAuth d'une GitHub App : URL d'autorisation, échange du code contre un
 * jeton utilisateur, renouvellement, révocation. C'est le seul module qui appelle `/login/oauth/*` et
 * `/applications/{client_id}/token`. Chaque appel a un délai (`GITHUB_TIMEOUT_MS`) et aucune reprise
 * automatique. Le secret client ne sort jamais de ce module ; aucun corps de réponse n'est journalisé.
 * `refresh_refused` : GitHub refuse le jeton de rafraîchissement (expiré, déjà utilisé, révoqué) ;
 * `client_rejected` : GitHub refuse l'identifiant ou le secret de l'app elle-même.
 */
export type OAuthFailure = "exchange_refused" | "refresh_refused" | "client_rejected" | "upstream" | "timeout";

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
  /** Jeton de rafraîchissement et sa durée (secondes) ; absents si l'app n'expire pas ses jetons. */
  readonly refreshToken: string | undefined;
  readonly refreshExpiresIn: number | undefined;
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
  const result = await requestToken(github, {
    code: params.code,
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier,
  });
  if ("refusal" in result) throw new GitHubOAuthError("exchange_refused");
  return result;
}

/**
 * Renouvelle un jeton utilisateur. GitHub invalide alors l'ancien jeton d'accès ET l'ancien jeton de
 * rafraîchissement : la réponse porte les deux nouveaux, à enregistrer aussitôt.
 */
export async function refreshUserToken(github: GitHubSettings, refreshToken: string): Promise<GrantedToken> {
  const result = await requestToken(github, { grant_type: "refresh_token", refresh_token: refreshToken });
  if (!("refusal" in result)) return result;
  // Un secret d'app faux n'est pas la faute de la session : il ne doit pas déconnecter tout le monde.
  throw new GitHubOAuthError(result.refusal === "incorrect_client_credentials" ? "client_rejected" : "refresh_refused");
}

/**
 * `POST /login/oauth/access_token` : le jeton accordé, ou le code du refus (GitHub répond HTTP 200 avec
 * un champ `error` quand il refuse). Le code n'est lu que pour être classé, jamais relayé.
 */
async function requestToken(
  github: GitHubSettings,
  grant: Readonly<Record<string, string>>,
): Promise<GrantedToken | { readonly refusal: string }> {
  const response = await send(github, `${github.webUrl}/login/oauth/access_token`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: github.clientId, client_secret: github.clientSecret, ...grant }),
  });
  if (!response.ok) throw new GitHubOAuthError("upstream");
  const body: unknown = await response.json().catch(() => null);
  const refused = TokenRefused.safeParse(body);
  if (refused.success) return { refusal: refused.data.error };
  const granted = TokenGranted.safeParse(body);
  if (!granted.success) throw new GitHubOAuthError("upstream");
  return {
    accessToken: granted.data.access_token,
    expiresIn: granted.data.expires_in,
    refreshToken: granted.data.refresh_token,
    refreshExpiresIn: granted.data.refresh_token_expires_in,
  };
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
    // Réseau injoignable : Bun lève une `Error` à `code` texte (`ConnectionRefused`…), les navigateurs
    // un `TypeError`. Sans ce cas, la connexion finissait en 500 et la déconnexion en erreur.
    const code: unknown = err instanceof Error ? (err as { code?: unknown }).code : undefined;
    if (err instanceof TypeError || typeof code === "string") throw new GitHubOAuthError("upstream");
    throw err;
  }
}
