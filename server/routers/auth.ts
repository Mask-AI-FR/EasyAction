import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { LoginErrorCode } from "../../domain/apiContract.ts";
import { GitHubApiError } from "../adapters/githubApi.ts";
import { getViewer } from "../adapters/githubRepos.ts";
import {
  authorizeUrl,
  exchangeCode,
  GitHubOAuthError,
  revokeToken,
} from "../adapters/githubOAuth.ts";
import { codeChallengeOf, randomToken, sameSecret } from "../auth/pkce.ts";
import {
  FLOW_MAX_AGE_SECONDS,
  openOAuthFlow,
  openSession,
  sealOAuthFlow,
  sealSession,
  type CookiePolicy,
  type OAuthFlow,
} from "../auth/sessionCookie.ts";
import type { PiplinerEnv } from "../config/env.ts";
import { errorFields, logger } from "../config/logger.ts";
import { originGuard } from "../middleware/originGuard.ts";
import { CallbackQuery, safeReturnTo } from "../schemas/api.schema.ts";

/** Ce dont les routes d'authentification et d'API ont besoin, construit une fois par `buildApp`. */
export interface AuthDeps {
  readonly env: PiplinerEnv;
  readonly key: Uint8Array;
  readonly cookies: CookiePolicy;
}

/**
 * Connexion par GitHub App (flux « web application » avec `state` + PKCE S256) :
 * `GET /auth/login` → GitHub → `GET /auth/callback` → cookie de session → retour à la page demandée.
 * `POST /auth/logout` efface la session et révoque le jeton. Les échecs renvoient vers
 * `/login?error=<code>` avec un code stable, jamais un message de GitHub.
 */
export function authRouter(deps: AuthDeps): Hono {
  return new Hono()
    .get("/login", (c) => startSignIn(c, deps))
    .get("/callback", (c) => finishSignIn(c, deps))
    .post("/logout", originGuard(deps.env.appOrigin), (c) => signOut(c, deps));
}

function callbackUrl(env: PiplinerEnv): string {
  return `${env.appOrigin}/auth/callback`;
}

function cookieAttributes(deps: AuthDeps, maxAge: number) {
  return { httpOnly: true, secure: deps.cookies.secure, sameSite: "Lax", path: "/", maxAge } as const;
}

async function startSignIn(c: Context, deps: AuthDeps): Promise<Response> {
  const state = randomToken();
  const codeVerifier = randomToken();
  const returnTo = safeReturnTo(c.req.query("returnTo"));
  const sealed = await sealOAuthFlow({ state, codeVerifier, returnTo }, deps.key);
  setCookie(c, deps.cookies.flowName, sealed, cookieAttributes(deps, FLOW_MAX_AGE_SECONDS));
  const target = authorizeUrl(deps.env.github, {
    state,
    codeChallenge: codeChallengeOf(codeVerifier),
    redirectUri: callbackUrl(deps.env),
  });
  return c.redirect(target, 302);
}

async function finishSignIn(c: Context, deps: AuthDeps): Promise<Response> {
  const flow = await openOAuthFlow(getCookie(c, deps.cookies.flowName), deps.key);
  deleteCookie(c, deps.cookies.flowName, { path: "/", secure: deps.cookies.secure });
  const query = CallbackQuery.safeParse(c.req.query());
  // ÉCHEC FERMÉ (anti-falsification) : sans flux valide, sans code ou avec un `state` différent,
  // aucun échange n'est tenté.
  if (!flow || !query.success) return backToSignIn(c, "expired");
  if (query.data.error) {
    return backToSignIn(c, query.data.error === "access_denied" ? "denied" : "github");
  }
  const { code, state } = query.data;
  if (!code || !state || !sameSecret(state, flow.state)) return backToSignIn(c, "expired");
  try {
    return await openUserSession(c, deps, flow, code);
  } catch (err) {
    if (!(err instanceof GitHubOAuthError || err instanceof GitHubApiError)) throw err;
    // ÉCHEC FERMÉ : GitHub n'a pas abouti, aucun cookie de session n'est posé.
    logger.warn("auth.sign_in_failed", {
      route: "/auth/callback",
      upstream: "github",
      ...errorFields(err),
    });
    return backToSignIn(c, "github");
  }
}

async function openUserSession(
  c: Context,
  deps: AuthDeps,
  flow: OAuthFlow,
  code: string,
): Promise<Response> {
  const { github } = deps.env;
  const token = await exchangeCode(github, {
    code,
    codeVerifier: flow.codeVerifier,
    redirectUri: callbackUrl(deps.env),
  });
  if (token.expiresIn === undefined) {
    // ÉCHEC FERMÉ : l'app GitHub doit expirer ses jetons utilisateur (8 h) ; un jeton sans fin
    // n'est ni conservé ni laissé actif.
    logger.warn("auth.token_without_expiry", { route: "/auth/callback", upstream: "github" });
    await revokeQuietly(deps, token.accessToken, "/auth/callback");
    return backToSignIn(c, "config");
  }
  const viewer = await getViewer(github, token.accessToken).catch(async (err: unknown) => {
    await revokeQuietly(deps, token.accessToken, "/auth/callback");
    throw err;
  });
  const expiresAt = Math.floor(Date.now() / 1000) + token.expiresIn;
  const sealed = await sealSession(
    { userId: viewer.id, login: viewer.login, avatarUrl: viewer.avatarUrl, accessToken: token.accessToken, expiresAt },
    deps.key,
  );
  setCookie(c, deps.cookies.sessionName, sealed, cookieAttributes(deps, token.expiresIn));
  logger.info("auth.signed_in", { route: "/auth/callback" });
  return c.redirect(flow.returnTo, 303);
}

async function signOut(c: Context, deps: AuthDeps): Promise<Response> {
  const session = await openSession(getCookie(c, deps.cookies.sessionName), deps.key);
  deleteCookie(c, deps.cookies.sessionName, { path: "/", secure: deps.cookies.secure });
  if (session) await revokeQuietly(deps, session.accessToken, "/auth/logout");
  return c.body(null, 204);
}

/**
 * ÉCHEC OUVERT : une révocation qui échoue est journalisée sans bloquer. Le cookie est déjà effacé,
 * et le jeton GitHub expire de lui-même en 8 heures au plus.
 */
async function revokeQuietly(deps: AuthDeps, accessToken: string, route: string): Promise<void> {
  try {
    await revokeToken(deps.env.github, accessToken);
  } catch (err) {
    if (!(err instanceof GitHubOAuthError)) throw err;
    logger.warn("auth.revoke_failed", { route, upstream: "github", ...errorFields(err) });
  }
}

function backToSignIn(c: Context, reason: LoginErrorCode): Response {
  return c.redirect(`/login?error=${reason}`, 303);
}
