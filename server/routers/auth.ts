import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { LoginErrorCode } from "../../domain/apiContract.ts";
import { GitHubApiError } from "../adapters/githubApi.ts";
import { getViewer } from "../adapters/githubRepos.ts";
import { authorizeUrl, exchangeCode, GitHubOAuthError } from "../adapters/githubOAuth.ts";
import { codeChallengeOf, randomToken, sameSecret } from "../auth/pkce.ts";
import {
  FLOW_MAX_AGE_SECONDS,
  openOAuthFlow,
  sealOAuthFlow,
  type CookiePolicy,
  type OAuthFlow,
} from "../auth/sessionCookie.ts";
import type { PiplinerEnv } from "../config/env.ts";
import { errorFields, logger } from "../config/logger.ts";
import { originGuard } from "../middleware/originGuard.ts";
import { CallbackQuery, safeReturnTo } from "../schemas/api.schema.ts";
import { toFreshTokens, type GitHubTokens } from "../services/githubTokens.ts";
import type { DashboardCollector } from "../services/dashboardCollector.ts";
import { endSessions, openSession, resolveSession, type SessionStore } from "../services/sessions.ts";
import type { EffectiveSettings } from "../services/settings.ts";
import type { TwoFactorStore } from "../services/twoFactor.ts";

/** Ce dont les routes d'authentification et d'API ont besoin, construit une fois par `buildApp`. */
export interface AuthDeps {
  readonly env: PiplinerEnv;
  /** Clé du cookie de flux de connexion (dérivée de `SESSION_SECRET`). */
  readonly key: Uint8Array;
  readonly cookies: CookiePolicy;
  readonly sessions: SessionStore;
  readonly tokens: GitHubTokens;
  readonly twoFactor: TwoFactorStore;
  /** Réglages du site en vigueur (connexion à GitHub, plafonds), relus à chaque appel. */
  readonly settings: () => EffectiveSettings;
  /** Tableau de bord : collecte et mémoire courte, effacée à la déconnexion et aux changements de réglages. */
  readonly dashboard: DashboardCollector;
}

/**
 * Connexion par GitHub App (flux « web application » avec `state` + PKCE S256) :
 * `GET /auth/login` → GitHub → `GET /auth/callback` → session en base + cookie → retour à la page
 * demandée. `POST /auth/logout` ferme la session et révoque le jeton. Les échecs renvoient vers
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

/** Attributs des cookies de Pipliner : HttpOnly, SameSite=Lax, Path=/, Secure en https. */
export function sessionCookieAttributes(deps: Pick<AuthDeps, "cookies">, maxAge: number) {
  return { httpOnly: true, secure: deps.cookies.secure, sameSite: "Lax", path: "/", maxAge } as const;
}

async function startSignIn(c: Context, deps: AuthDeps): Promise<Response> {
  const state = randomToken();
  const codeVerifier = randomToken();
  const returnTo = safeReturnTo(c.req.query("returnTo"));
  const sealed = await sealOAuthFlow({ state, codeVerifier, returnTo }, deps.key);
  setCookie(c, deps.cookies.flowName, sealed, sessionCookieAttributes(deps, FLOW_MAX_AGE_SECONDS));
  const target = authorizeUrl(deps.settings().github, {
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
  const { github } = deps.settings();
  const granted = await exchangeCode(github, {
    code,
    codeVerifier: flow.codeVerifier,
    redirectUri: callbackUrl(deps.env),
  });
  const tokens = toFreshTokens(granted);
  if (!tokens) {
    // ÉCHEC FERMÉ : l'app GitHub doit expirer ses jetons utilisateur (8 h, avec un jeton de
    // rafraîchissement) ; un jeton sans fin n'est ni conservé ni laissé actif.
    logger.warn("auth.token_without_expiry", { route: "/auth/callback", upstream: "github" });
    await deps.tokens.revokeQuietly(granted.accessToken, "/auth/callback");
    return backToSignIn(c, "config");
  }
  const viewer = await getViewer(github, tokens.accessToken).catch(async (err: unknown) => {
    await deps.tokens.revokeQuietly(tokens.accessToken, "/auth/callback");
    throw err;
  });
  const opened = openSession(deps.sessions, viewer, tokens, getCookie(c, deps.cookies.sessionName));
  await deps.tokens.revokeEnded(opened.ended, "/auth/callback");
  setCookie(c, deps.cookies.sessionName, opened.cookieValue, sessionCookieAttributes(deps, opened.maxAgeSeconds));
  logger.info("auth.signed_in", { route: "/auth/callback" });
  return c.redirect(flow.returnTo, 303);
}

/** Ferme la session de ce navigateur (s'il en a une), puis révoque son jeton GitHub (échec ouvert). */
async function signOut(c: Context, deps: AuthDeps): Promise<Response> {
  const cookie = getCookie(c, deps.cookies.sessionName);
  deleteCookie(c, deps.cookies.sessionName, { path: "/", secure: deps.cookies.secure });
  const session = cookie ? resolveSession(deps.sessions, cookie) : null;
  if (session) {
    const ended = endSessions(
      deps.sessions,
      { idHash: session.idHash },
      { action: "session.end", actorId: session.userId },
    );
    deps.dashboard.forgetUser(session.userId);
    await deps.tokens.revokeEnded(ended, "/auth/logout");
  }
  return c.body(null, 204);
}

function backToSignIn(c: Context, reason: LoginErrorCode): Response {
  return c.redirect(`/login?error=${reason}`, 303);
}
