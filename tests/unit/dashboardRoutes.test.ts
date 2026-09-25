import "../support/testEnv.ts";
import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { FAKE_INSTALLATION_ID, FakeGitHub, type FakeRepo } from "../support/fakeGithub.ts";
import { FAKE_OWNER, signInDirectly } from "../support/sessions.ts";
import type { ApiErrorBody } from "../../domain/apiContract.ts";
import type { DashboardBody } from "../../domain/dashboardContract.ts";
import { buildApp } from "../../server/app.ts";
import { setUserRole } from "../../server/repositories/users.ts";

const github = new FakeGitHub();

beforeEach(() => spyOn(process.stdout, "write").mockImplementation(() => true));
afterEach(() => {
  spyOn(process.stdout, "write").mockRestore();
  github.reset();
});
afterAll(() => github.stop());

const recent = new Date(Date.now() - 86_400_000).toISOString().replace(/\.\d{3}Z$/, "Z");

const API_REPO: FakeRepo = {
  name: "api",
  pushedAt: recent,
  defaultBranch: "main",
  runs: [
    {
      workflow_id: 1,
      name: "CI",
      path: ".github/workflows/ci.yml",
      status: "completed",
      conclusion: "failure",
      created_at: recent,
      run_started_at: recent,
      updated_at: recent,
      head_branch: "main",
      event: "push",
      html_url: "https://github.com/acme/api/actions/runs/9",
    },
  ],
  branches: [{ name: "main", committedDate: recent }],
  history: [{ oid: "c1", committedDate: recent, author: { email: "dev@example.com", user: { login: "octo-cat" } } }],
  branchOnly: {},
};

/** Une application et une base pour tout le test : la mémoire du tableau de bord vit dans l'application. */
function server() {
  const env = github.env();
  const db = github.database();
  const app = buildApp(env, db);
  const call = (path: string, cookie: string | null, init: { method?: string; json?: unknown } = {}) => {
    const headers: Record<string, string> = { Origin: env.appOrigin };
    if (cookie) headers.Cookie = `pipliner_session=${cookie}`;
    if (init.json !== undefined) headers["Content-Type"] = "application/json";
    return app.request(path, {
      method: init.method ?? "GET",
      headers,
      body: init.json === undefined ? undefined : JSON.stringify(init.json),
    });
  };
  return { env, db, call };
}

const listings = () => github.callsTo("GET", `/user/installations/${FAKE_INSTALLATION_ID}/repositories`).length;

describe("GET /api/orgs/:org/dashboard", () => {
  test("statistiques de l'organisation, jamais une identité, jamais en cache chez le navigateur", async () => {
    github.serveOrg("acme", [API_REPO]);
    const { env, db, call } = server();
    const response = await call("/api/orgs/acme/dashboard?days=7", signInDirectly(env, db));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as DashboardBody;
    expect(body).toMatchObject({ org: "acme", days: 7, bucket: "day" });
    expect(body.timeline).toHaveLength(7);
    expect(body.kpis.failedRuns.current).toBe(1);
    expect(body.kpis.committers.current).toBe(1);
    expect(JSON.stringify(body)).not.toMatch(/octo-cat|example\.com/);
  });

  test("période inconnue : 400 avant tout appel à GitHub ; organisation sans l'app : 404", async () => {
    github.serveOrg("acme", [API_REPO]);
    const { env, db, call } = server();
    const cookie = signInDirectly(env, db);
    expect((await call("/api/orgs/acme/dashboard?days=5", cookie)).status).toBe(400);
    expect(github.calls).toHaveLength(0);
    const response = await call("/api/orgs/other/dashboard?days=30", cookie);
    expect(response.status).toBe(404);
    expect(((await response.json()) as ApiErrorBody).detail.code).toBe("not_found");
  });

  test("sans session : 401 ; sans le code du jour : 403", async () => {
    github.serveOrg("acme", [API_REPO]);
    const { env, db, call } = server();
    expect((await call("/api/orgs/acme/dashboard?days=7", null)).status).toBe(401);
    const unverified = await call("/api/orgs/acme/dashboard?days=7", signInDirectly(env, db, { verified: false }));
    expect(unverified.status).toBe(403);
    expect(((await unverified.json()) as ApiErrorBody).detail.code).toBe("second_factor_required");
  });

  test("limite de débit de GitHub : 429 avec le temps d'attente", async () => {
    github.serveOrg("acme", [
      { ...API_REPO, runsFailure: () => new Response("", { status: 429, headers: { "retry-after": "120" } }) },
    ]);
    const { env, db, call } = server();
    const response = await call("/api/orgs/acme/dashboard?days=7", signInDirectly(env, db));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("120");
  });

  test("mémoire effacée à la déconnexion et quand un administrateur change les plafonds", async () => {
    github.serveOrg("acme", [API_REPO]);
    const { env, db, call } = server();
    const first = signInDirectly(env, db);
    await call("/api/orgs/acme/dashboard?days=7", first);
    await call("/api/orgs/acme/dashboard?days=7", first);
    expect(listings()).toBe(1);
    expect((await call("/auth/logout", first, { method: "POST" })).status).toBe(204);
    const second = signInDirectly(env, db);
    await call("/api/orgs/acme/dashboard?days=7", second);
    expect(listings()).toBe(2);
    setUserRole(db, FAKE_OWNER.id, "admin");
    const saved = await call("/api/admin/settings/limits", second, { method: "PUT", json: { values: { statsCacheSeconds: 600 } } });
    expect(saved.status).toBe(200);
    await call("/api/orgs/acme/dashboard?days=7", second);
    expect(listings()).toBe(3);
  });
});
