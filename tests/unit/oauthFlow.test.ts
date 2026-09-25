import "../support/testEnv.ts";
import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { FakeGitHub } from "../support/fakeGithub.ts";
import { signInDirectly } from "../support/sessions.ts";
import { testDatabase } from "../support/testDatabase.ts";
import { buildApp } from "../../server/app.ts";
import { codeChallengeOf } from "../../server/auth/pkce.ts";
import { parseEnv } from "../../server/config/env.ts";

const github = new FakeGitHub();
const env = github.env();
const connection = github.settings();
const db = github.database();
const app = buildApp(env, db);
const TOKEN_PATH = "/login/oauth/access_token";
const REVOKE_PATH = `/applications/${connection.clientId}/token`;
const GRANTED = {
  access_token: "ghu_not-a-real-token",
  token_type: "bearer",
  expires_in: 28_800,
  refresh_token: "ghr_not-a-real-refresh-token",
  refresh_token_expires_in: 15_897_600,
};
const THIRTY_DAYS = 30 * 86_400;

/** Lignes de la base, pour vérifier ce qui est gardé (et comment). */
const sessionRows = () =>
  db.query<{ user_id: number; access_token_enc: string; refresh_token_enc: string }, []>("SELECT * FROM sessions").all();
const actions = () => db.query<{ action: string }, []>("SELECT action FROM audit_events ORDER BY id").all().map((row) => row.action);

let logged: string[] = [];

beforeEach(() => {
  github.reset();
  db.run("DELETE FROM users");
  db.run("DELETE FROM audit_events");
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

async function signIn(returnTo = "/orgs", previousSession?: string) {
  githubAnswers();
  const start = await beginSignIn(returnTo);
  const cookies = [`pipliner_oauth=${start.flow}`, ...(previousSession ? [`pipliner_session=${previousSession}`] : [])];
  const response = await app.request(`/auth/callback?code=code-123&state=${start.state}`, {
    headers: { Cookie: cookies.join("; ") },
  });
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
    expect(location.searchParams.get("client_id")).toBe(connection.clientId);
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
    expect(exchange.client_id).toBe(connection.clientId);
    expect(exchange.client_secret).toBe(connection.clientSecret);
    expect(exchange.code).toBe("code-123");
    expect(codeChallengeOf(exchange.code_verifier)).toBe(start.challenge);
    const viewer = github.callsTo("GET", "/user")[0];
    expect(viewer?.headers.get("authorization")).toBe("Bearer ghu_not-a-real-token");
    const header = setCookieHeader(response, "pipliner_session");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    // « Rester connecté » : SESSION_MAX_DAYS (30 j), et non plus les 8 h du jeton GitHub.
    expect(header).toContain(`Max-Age=${THIRTY_DAYS}`);
    expect(setCookieHeader(response, "pipliner_oauth")).toContain("Max-Age=0");
  });

  test("la session est gardée en base, jetons GitHub chiffrés, connexion inscrite à l'historique", async () => {
    const { session } = await signIn();
    const rows = sessionRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.user_id).toBe(42);
    const stored = JSON.stringify(rows);
    expect(stored).not.toContain("ghu_");
    expect(stored).not.toContain("ghr_");
    expect(stored).not.toContain(session);
    expect(actions()).toEqual(["session.create"]);
  });

  test("se reconnecter dans le même navigateur ferme l'ancienne session et révoque son jeton", async () => {
    const first = await signIn();
    const second = await signIn("/orgs", first.session);
    expect(second.session).not.toBe(first.session);
    expect(sessionRows()).toHaveLength(1);
    expect(github.callsTo("DELETE", REVOKE_PATH)).toHaveLength(1);
    const stale = await app.request("/api/session", { headers: { Cookie: `pipliner_session=${first.session}` } });
    expect(stale.status).toBe(401);
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
      role: "member",
    });
    // Première connexion : l'application d'authentification reste à mettre en place.
    expect(body.secondFactor).toBe("setup");
    expect(Date.parse(body.expiresAt)).toBeGreaterThan(Date.now() + (THIRTY_DAYS - 60) * 1000);
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

  test("GitHub injoignable pendant l'échange : retour à la connexion, pas une erreur 500", async () => {
    // Régression : Bun lève une `Error` à code `ConnectionRefused`, que seul `TypeError` attrapait.
    const offline = buildApp(parseEnv(process.env), testDatabase());
    const start = await offline.request("/auth/login?returnTo=%2Forgs");
    const flow = cookieValue(start, "pipliner_oauth") ?? "";
    const state = new URL(start.headers.get("location") ?? "").searchParams.get("state") ?? "";
    const response = await offline.request(`/auth/callback?code=code-123&state=${state}`, {
      headers: { Cookie: `pipliner_oauth=${flow}` },
    });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/login?error=github");
  });

  test("sans jeton de rafraîchissement, la session ne pourrait pas durer : refusée et révoquée", async () => {
    githubAnswers({ access_token: "ghu_not-a-real-token", token_type: "bearer", expires_in: 28_800 });
    const { flow, state } = await beginSignIn();
    const response = await callback(`code=code-123&state=${state}`, flow);
    expect(response.headers.get("location")).toBe("/login?error=config");
    expect(sessionRows()).toHaveLength(0);
    expect(github.callsTo("DELETE", REVOKE_PATH)).toHaveLength(1);
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
    expect(sessionRows()).toHaveLength(0);
    expect(actions()).toEqual(["session.create", "session.end"]);
    const revoke = github.callsTo("DELETE", REVOKE_PATH)[0];
    const credentials = btoa(`${connection.clientId}:${connection.clientSecret}`);
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

  test("GitHub injoignable pendant la révocation : déconnecté quand même (échec ouvert)", async () => {
    // Régression : l'erreur réseau de Bun n'était pas une `GitHubOAuthError` et finissait en 500.
    const offlineEnv = parseEnv(process.env);
    const offlineDb = testDatabase();
    const offline = buildApp(offlineEnv, offlineDb);
    const session = signInDirectly(offlineEnv, offlineDb);
    const response = await offline.request("/auth/logout", {
      method: "POST",
      headers: { Origin: offlineEnv.appOrigin, Cookie: `pipliner_session=${session}` },
    });
    expect(response.status).toBe(204);
    expect(logged.join("")).toContain("auth.revoke_failed");
  });

  test("sans en-tête Origin : refusée (anti-CSRF)", async () => {
    const { session } = await signIn();
    const response = await logout({ Cookie: `pipliner_session=${session}` });
    expect(response.status).toBe(403);
    expect(github.callsTo("DELETE", REVOKE_PATH)).toHaveLength(0);
  });
});
