import "../support/testEnv.ts";
import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { FakeGitHub } from "../support/fakeGithub.ts";
import { sessionStoreOf, signInDirectly } from "../support/sessions.ts";
import { TEST_GITHUB, testDatabase } from "../support/testDatabase.ts";
import { GitHubApiError } from "../../server/adapters/githubApi.ts";
import { buildApp } from "../../server/app.ts";
import type { GitHubSettings } from "../../server/config/env.ts";
import { HttpError } from "../../server/exceptions/HttpError.ts";
import { deriveDataKey } from "../../server/security/dataCipher.ts";
import { GitHubTokens, type TokenLease } from "../../server/services/githubTokens.ts";
import { resolveSession, type SessionStore } from "../../server/services/sessions.ts";

const github = new FakeGitHub();
const env = github.env();
const TOKEN_PATH = "/login/oauth/access_token";
const REVOKE_PATH = `/applications/${github.settings().clientId}/token`;
const ROTATED = {
  access_token: "ghu_rotated-token",
  token_type: "bearer",
  expires_in: 28_800,
  refresh_token: "ghr_rotated-refresh-token",
  refresh_token_expires_in: 15_897_600,
};

beforeEach(() => {
  github.reset();
  github.respond("POST", TOKEN_PATH, () => Response.json(ROTATED));
  github.respond("DELETE", REVOKE_PATH, () => new Response(null, { status: 204 }));
  spyOn(process.stdout, "write").mockImplementation(() => true);
  spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  spyOn(process.stdout, "write").mockRestore();
  spyOn(process.stderr, "write").mockRestore();
});

afterAll(() => github.stop());

interface Setup {
  readonly store: SessionStore;
  readonly tokens: GitHubTokens;
  readonly idHash: string;
}

/** Une session dont le jeton d'accès expire dans `accessExpiresIn` secondes ; GitHub = le faux, ou `connection`. */
function setup(accessExpiresIn: number, connection: GitHubSettings = github.settings()): Setup {
  const store = sessionStoreOf(env, testDatabase(connection));
  const cookie = signInDirectly(env, store.db, { tokens: { accessExpiresIn } });
  return { store, tokens: new GitHubTokens(store, () => connection), idHash: resolveSession(store, cookie)?.idHash ?? "" };
}

async function failureOf(lease: Promise<TokenLease>): Promise<unknown> {
  return lease.then(() => new Error("aucun échec"), (err: unknown) => err);
}

const generation = (store: SessionStore) =>
  store.db.query<{ g: number }, []>("SELECT token_generation AS g FROM sessions").get()?.g;

describe("jetons GitHub des sessions", () => {
  test("jeton encore valable plus de 30 min : rendu tel quel, sans appel à GitHub", async () => {
    const { tokens, idHash } = setup(3600);
    expect(await tokens.lease(idHash)).toEqual({ token: "ghu_not-a-real-token", generation: 1 });
    expect(github.callsTo("POST", TOKEN_PATH)).toHaveLength(0);
  });

  test("moins de 2 min : renouvelé, et la rotation est enregistrée (génération + 1)", async () => {
    const { store, tokens, idHash } = setup(60);
    expect(await tokens.lease(idHash)).toEqual({ token: "ghu_rotated-token", generation: 2 });
    const sent = JSON.parse(github.callsTo("POST", TOKEN_PATH)[0]?.body ?? "{}");
    expect(sent).toMatchObject({ grant_type: "refresh_token", refresh_token: "ghr_not-a-real-refresh-token" });
    expect(sent.client_secret).toBe(github.settings().clientSecret);
    expect(generation(store)).toBe(2);
    // Le jeton renouvelé est ensuite relu en base, sans nouvel appel.
    expect(await tokens.lease(idHash)).toEqual({ token: "ghu_rotated-token", generation: 2 });
    expect(github.callsTo("POST", TOKEN_PATH)).toHaveLength(1);
  });

  test("deux demandes simultanées : un seul renouvellement, le même nouveau jeton pour les deux", async () => {
    const { tokens, idHash } = setup(60);
    const [first, second] = await Promise.all([tokens.lease(idHash), tokens.lease(idHash)]);
    expect(first).toEqual(second);
    expect(github.callsTo("POST", TOKEN_PATH)).toHaveLength(1);
  });

  test("renouvellement anticipé (moins de 30 min) seulement quand aucune autre requête n'est en cours", async () => {
    const { tokens, idHash } = setup(20 * 60);
    tokens.enter(idHash);
    tokens.enter(idHash);
    expect((await tokens.lease(idHash)).generation).toBe(1);
    tokens.leave(idHash);
    expect((await tokens.lease(idHash)).generation).toBe(2);
  });

  test("une opération longue exige une validité minimale : renouvelé si le jeton ne tiendra pas", async () => {
    const { tokens, idHash } = setup(5 * 60);
    tokens.enter(idHash);
    tokens.enter(idHash);
    expect((await tokens.lease(idHash, { minValidityMs: 10 * 60_000 })).generation).toBe(2);
  });

  test("jeton de rafraîchissement refusé : session fermée, 401 (échec fermé)", async () => {
    github.respond("POST", TOKEN_PATH, () => Response.json({ error: "bad_refresh_token" }));
    const { store, tokens, idHash } = setup(60);
    const failure = await failureOf(tokens.lease(idHash));
    expect(failure).toBeInstanceOf(HttpError);
    expect((failure as HttpError).status).toBe(401);
    expect(generation(store)).toBeUndefined();
  });

  test("secret de l'app refusé par GitHub : 502, la session reste (ce n'est pas elle qui est en cause)", async () => {
    github.respond("POST", TOKEN_PATH, () => Response.json({ error: "incorrect_client_credentials" }));
    const { store, tokens, idHash } = setup(60);
    const failure = await failureOf(tokens.lease(idHash));
    expect(failure).toBeInstanceOf(GitHubApiError);
    expect((failure as GitHubApiError).code).toBe("upstream");
    expect(generation(store)).toBe(1);
  });

  test("GitHub injoignable pendant le renouvellement : 502, la session reste", async () => {
    const { store, tokens, idHash } = setup(60, TEST_GITHUB);
    const failure = await failureOf(tokens.lease(idHash));
    expect((failure as GitHubApiError).code).toBe("upstream");
    expect(generation(store)).toBe(1);
  });

  test("session fermée pendant le renouvellement : 401, et le jeton obtenu est aussitôt révoqué", async () => {
    const { store, tokens, idHash } = setup(60);
    github.respond("POST", TOKEN_PATH, () => {
      store.db.run("DELETE FROM sessions");
      return Response.json(ROTATED);
    });
    expect(((await failureOf(tokens.lease(idHash))) as HttpError).status).toBe(401);
    expect(JSON.parse(github.callsTo("DELETE", REVOKE_PATH)[0]?.body ?? "{}")).toEqual({
      access_token: "ghu_rotated-token",
    });
  });

  test("jeton illisible (DATA_ENCRYPTION_KEY changée) : session fermée, 401 — jamais une erreur 500", async () => {
    const { store, idHash } = setup(3600);
    const rekeyed = new GitHubTokens({ ...store, dataKey: deriveDataKey("another-data-key-that-is-long-enough-000") }, () => github.settings());
    expect(((await failureOf(rekeyed.lease(idHash))) as HttpError).status).toBe(401);
    expect(generation(store)).toBeUndefined();
  });
});

describe("401 de GitHub pendant une requête de l'API", () => {
  function signedInApp() {
    const db = github.database();
    const cookie = signInDirectly(env, db);
    return { db, app: buildApp(env, db), headers: { Cookie: `pipliner_session=${cookie}` } };
  }

  test("jeton courant refusé (révoqué sur GitHub) : 401 et la session est fermée", async () => {
    github.respond("GET", "/user/installations", () => new Response("Bad credentials", { status: 401 }));
    const { db, app, headers } = signedInApp();
    expect((await app.request("/api/orgs", { headers })).status).toBe(401);
    expect(db.query("SELECT count(*) AS n FROM sessions").get()).toEqual({ n: 0 });
  });

  test("session renouvelée PENDANT la requête : 502 « réessayez », et la session reste ouverte", async () => {
    const { db, app, headers } = signedInApp();
    github.respond("GET", "/user/installations", () => {
      // Une autre requête de la session vient de renouveler les jetons : l'ancien ne vaut plus rien.
      db.run("UPDATE sessions SET token_generation = token_generation + 1");
      return new Response("Bad credentials", { status: 401 });
    });
    const response = await app.request("/api/orgs", { headers });
    expect(response.status).toBe(502);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(db.query("SELECT count(*) AS n FROM sessions").get()).toEqual({ n: 1 });
  });
});
