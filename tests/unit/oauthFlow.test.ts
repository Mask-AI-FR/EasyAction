import "../support/testEnv.ts";
import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { FakeGitHub } from "../support/fakeGithub.ts";
import { buildApp } from "../../server/app.ts";
import { codeChallengeOf } from "../../server/auth/pkce.ts";

const github = new FakeGitHub();
const env = github.env();
const app = buildApp(env);
const TOKEN_PATH = "/login/oauth/access_token";
const REVOKE_PATH = `/applications/${env.github.clientId}/token`;
const GRANTED = { access_token: "ghu_not-a-real-token", token_type: "bearer", expires_in: 28_800 };

let logged: string[] = [];

beforeEach(() => {
  github.reset();
  logged = [];
  // Le journal écrit sur stdout/stderr : on le capture pour les assertions, sans bruit.
  const capture = (chunk: unknown) => {
    logged.push(String(chunk));
    return true;
  };
  spyOn(process.stdout, "write").mockImplementation(capture);
  spyOn(process.stderr, "write").mockImplementation(capture);
});

afterEach(() => {
  spyOn(process.stdout, "write").mockRestore();
  spyOn(process.stderr, "write").mockRestore();
});

afterAll(() => github.stop());

function setCookieHeader(response: Response, name: string): string {
  return response.headers.getSetCookie().find((header) => header.startsWith(`${name}=`)) ?? "";
}

function cookieValue(response: Response, name: string): string | undefined {
  const value = setCookieHeader(response, name).slice(name.length + 1).split(";")[0];
  return value ? value : undefined;
}

function githubAnswers(token: object = GRANTED): void {
  github.respond("POST", TOKEN_PATH, () => Response.json(token));
  github.respond("GET", "/user", () =>
    Response.json({ id: 42, login: "octo-test", avatar_url: "https://avatars.githubusercontent.com/u/42?v=4" }),
  );
  github.respond("DELETE", REVOKE_PATH, () => new Response(null, { status: 204 }));
}

async function beginSignIn(returnTo = "/orgs") {
  const response = await app.request(`/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
  const location = new URL(response.headers.get("location") ?? "");
  return {
    response,
    location,
    flow: cookieValue(response, "pipliner_oauth") ?? "",
    state: location.searchParams.get("state") ?? "",
    challenge: location.searchParams.get("code_challenge") ?? "",
  };
}

async function callback(query: string, flow?: string): Promise<Response> {
  const headers: Record<string, string> = flow ? { Cookie: `pipliner_oauth=${flow}` } : {};
  return app.request(`/auth/callback?${query}`, { headers });
}

async function signIn(returnTo = "/orgs") {
  githubAnswers();
  const start = await beginSignIn(returnTo);
  const response = await callback(`code=code-123&state=${start.state}`, start.flow);
  return { start, response, session: cookieValue(response, "pipliner_session") ?? "" };
}

async function logout(headers: Record<string, string>): Promise<Response> {
  return app.request("/auth/logout", { method: "POST", headers });
}

describe("connexion GitHub (state + PKCE)", () => {
  test("GET /auth/login redirige vers GitHub avec state, défi PKCE S256 et adresse de retour", async () => {
    const { response, location, flow } = await beginSignIn();
    expect(response.status).toBe(302);
    expect(`${location.origin}${location.pathname}`).toBe(`${github.url}/login/oauth/authorize`);
    expect(location.searchParams.get("client_id")).toBe(env.github.clientId);
    expect(location.searchParams.get("redirect_uri")).toBe(`${env.appOrigin}/auth/callback`);
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(location.searchParams.get("state")).toHaveLength(43);
    expect(location.searchParams.get("code_challenge")).toHaveLength(43);
    const header = setCookieHeader(response, "pipliner_oauth");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Max-Age=600");
    expect(flow).not.toBe("");
  });

  test("sans cookie de flux : retour à la connexion, et aucun échange tenté", async () => {
    githubAnswers();
    const response = await callback("code=code-123&state=peu-importe");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/login?error=expired");
    expect(github.callsTo("POST", TOKEN_PATH)).toHaveLength(0);
  });

  test("un state différent de celui du cookie : aucun échange (anti-falsification)", async () => {
    githubAnswers();
    const { flow } = await beginSignIn();
    const response = await callback("code=code-123&state=state-forge", flow);
    expect(response.headers.get("location")).toBe("/login?error=expired");
    expect(github.callsTo("POST", TOKEN_PATH)).toHaveLength(0);
  });

  test("autorisation refusée sur GitHub : message dédié", async () => {
    const { flow, state } = await beginSignIn();
    const response = await callback(`error=access_denied&state=${state}`, flow);
    expect(response.headers.get("location")).toBe("/login?error=denied");
  });

  test("réussite : échange avec le vérificateur PKCE, session posée, retour à la page demandée", async () => {
    const { start, response } = await signIn("/orgs/Mask-AI-FR");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/orgs/Mask-AI-FR");
    const exchange = JSON.parse(github.callsTo("POST", TOKEN_PATH)[0]?.body ?? "{}");
    expect(exchange.client_id).toBe(env.github.clientId);
    expect(exchange.client_secret).toBe(env.github.clientSecret);
    expect(exchange.code).toBe("code-123");
    expect(codeChallengeOf(exchange.code_verifier)).toBe(start.challenge);
    const viewer = github.callsTo("GET", "/user")[0];
    expect(viewer?.headers.get("authorization")).toBe("Bearer ghu_not-a-real-token");
    const header = setCookieHeader(response, "pipliner_session");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Max-Age=28800");
    expect(setCookieHeader(response, "pipliner_oauth")).toContain("Max-Age=0");
  });

  test("la session se lit par l'API, sans jamais exposer le jeton GitHub", async () => {
    const { session } = await signIn();
    const response = await app.request("/api/session", {
      headers: { Cookie: `pipliner_session=${session}` },
    });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain("ghu_");
    const body = JSON.parse(text);
    expect(body.user).toEqual({
      login: "octo-test",
      avatarUrl: "https://avatars.githubusercontent.com/u/42?v=4",
    });
    expect(Date.parse(body.expiresAt)).toBeGreaterThan(Date.now());
  });

  test("une adresse de retour vers un autre site est remplacée par /orgs", async () => {
    const { response } = await signIn("//evil.example/steal");
    expect(response.headers.get("location")).toBe("/orgs");
  });

  test("GitHub répond 200 avec un champ error : pas de session", async () => {
    githubAnswers({ error: "bad_verification_code" });
    const { flow, state } = await beginSignIn();
    const response = await callback(`code=code-123&state=${state}`, flow);
    expect(response.headers.get("location")).toBe("/login?error=github");
    expect(cookieValue(response, "pipliner_session")).toBeUndefined();
    expect(logged.join("")).toContain("auth.sign_in_failed");
  });

  test("GitHub en panne pendant l'échange : pas de session", async () => {
    githubAnswers();
    github.respond("POST", TOKEN_PATH, () => new Response("down", { status: 502 }));
    const { flow, state } = await beginSignIn();
    const response = await callback(`code=code-123&state=${state}`, flow);
    expect(response.headers.get("location")).toBe("/login?error=github");
    expect(cookieValue(response, "pipliner_session")).toBeUndefined();
  });

  test("un jeton sans expiration est refusé et aussitôt révoqué", async () => {
    githubAnswers({ access_token: "ghu_not-a-real-token", token_type: "bearer" });
    const { flow, state } = await beginSignIn();
    const response = await callback(`code=code-123&state=${state}`, flow);
    expect(response.headers.get("location")).toBe("/login?error=config");
    expect(cookieValue(response, "pipliner_session")).toBeUndefined();
    expect(github.callsTo("DELETE", REVOKE_PATH)).toHaveLength(1);
    expect(github.callsTo("GET", "/user")).toHaveLength(0);
  });
});

describe("déconnexion", () => {
  test("efface la session et révoque le jeton avec l'authentification Basic de l'app", async () => {
    const { session } = await signIn();
    const response = await logout({ Origin: env.appOrigin, Cookie: `pipliner_session=${session}` });
    expect(response.status).toBe(204);
    expect(setCookieHeader(response, "pipliner_session")).toContain("Max-Age=0");
    const revoke = github.callsTo("DELETE", REVOKE_PATH)[0];
    const credentials = btoa(`${env.github.clientId}:${env.github.clientSecret}`);
    expect(revoke?.headers.get("authorization")).toBe(`Basic ${credentials}`);
    expect(JSON.parse(revoke?.body ?? "{}")).toEqual({ access_token: "ghu_not-a-real-token" });
  });

  test("une révocation qui échoue ne bloque pas la déconnexion (échec ouvert) et se journalise", async () => {
    const { session } = await signIn();
    github.respond("DELETE", REVOKE_PATH, () => new Response("down", { status: 500 }));
    const response = await logout({ Origin: env.appOrigin, Cookie: `pipliner_session=${session}` });
    expect(response.status).toBe(204);
    expect(setCookieHeader(response, "pipliner_session")).toContain("Max-Age=0");
    expect(logged.join("")).toContain("auth.revoke_failed");
  });

  test("sans en-tête Origin : refusée (anti-CSRF)", async () => {
    const { session } = await signIn();
    const response = await logout({ Cookie: `pipliner_session=${session}` });
    expect(response.status).toBe(403);
    expect(github.callsTo("DELETE", REVOKE_PATH)).toHaveLength(0);
  });
});
