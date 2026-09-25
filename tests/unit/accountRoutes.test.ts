import "../support/testEnv.ts";
import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { FakeGitHub } from "../support/fakeGithub.ts";
import { signInDirectly } from "../support/sessions.ts";
import { testDatabase } from "../support/testDatabase.ts";
import type { AccountExportBody, AccountSessionsBody } from "../../domain/accountContract.ts";
import { buildApp } from "../../server/app.ts";

const github = new FakeGitHub();
const env = github.env();
const REVOKE_PATH = `/applications/${github.settings().clientId}/token`;

let db: Database;
let app: ReturnType<typeof buildApp>;
let mine: string;

beforeEach(() => {
  github.reset();
  github.respond("DELETE", REVOKE_PATH, () => new Response(null, { status: 204 }));
  db = github.database();
  app = buildApp(env, db);
  mine = signInDirectly(env, db);
  spyOn(process.stdout, "write").mockImplementation(() => true);
  spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  spyOn(process.stdout, "write").mockRestore();
  spyOn(process.stderr, "write").mockRestore();
});

afterAll(() => github.stop());

function call(path: string, options: { method?: "GET" | "POST"; cookie?: string; json?: unknown } = {}) {
  const headers: Record<string, string> = { Cookie: `pipliner_session=${options.cookie ?? mine}`, Origin: env.appOrigin };
  if (options.json !== undefined) headers["Content-Type"] = "application/json";
  const body = options.json === undefined ? undefined : JSON.stringify(options.json);
  return app.request(path, { method: options.method ?? "GET", headers, body });
}

const count = (sql: string) => db.query<{ n: number }, []>(sql).get()?.n;
const actions = () => db.query<{ action: string }, []>("SELECT action FROM audit_events ORDER BY id").all().map((row) => row.action);

describe("compte : sessions", () => {
  test("liste mes sessions, celle de ce navigateur marquée, sans jeton ni haché", async () => {
    signInDirectly(env, db);
    const response = await call("/api/account/sessions");
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain("ghu_");
    expect(text).not.toContain("v1.");
    const body = JSON.parse(text) as AccountSessionsBody;
    expect(body.sessions).toHaveLength(2);
    expect(body.sessions.filter((session) => session.current)).toHaveLength(1);
  });

  test("sans session : 401", async () => {
    expect((await call("/api/account/sessions", { cookie: "inconnu" })).status).toBe(401);
  });

  test("« Sign out other sessions » ferme les autres, révoque leurs jetons, garde celle-ci", async () => {
    const other = signInDirectly(env, db);
    const response = await call("/api/account/sessions/sign-out-others", { method: "POST" });
    expect(await response.json()).toEqual({ ended: 1 });
    expect(github.callsTo("DELETE", REVOKE_PATH)).toHaveLength(1);
    expect((await call("/api/session", { cookie: other })).status).toBe(401);
    expect((await call("/api/session")).status).toBe(200);
    expect(actions()).toContain("session.end_others");
  });

  test("une action sans l'en-tête Origin de l'app est refusée (anti-CSRF)", async () => {
    const response = await app.request("/api/account/sessions/sign-out-all", {
      method: "POST",
      headers: { Cookie: `pipliner_session=${mine}` },
    });
    expect(response.status).toBe(403);
    expect(count("SELECT count(*) AS n FROM sessions")).toBe(1);
  });

  test("« Sign out everywhere » ferme toutes mes sessions, celle-ci comprise, et efface le cookie", async () => {
    signInDirectly(env, db);
    const response = await call("/api/account/sessions/sign-out-all", { method: "POST" });
    expect(response.status).toBe(204);
    expect(response.headers.getSetCookie().join()).toContain("pipliner_session=;");
    expect(count("SELECT count(*) AS n FROM sessions")).toBe(0);
    expect(github.callsTo("DELETE", REVOKE_PATH)).toHaveLength(2);
    expect(actions()).toContain("session.end_all");
  });
});

describe("compte : mes données", () => {
  test("l'export se télécharge et contient tout, sauf jetons, chiffrés et hachés", async () => {
    const response = await call("/api/account/export");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename="easyactions-my-data-\d{4}-\d{2}-\d{2}\.json"$/);
    const text = await response.text();
    for (const secret of ["ghu_", "ghr_", "v1.", mine]) expect(text).not.toContain(secret);
    const body = JSON.parse(text) as AccountExportBody;
    expect(body.user).toMatchObject({ githubId: 42, login: "octo-test", role: "member" });
    expect(body.sessions).toHaveLength(1);
    expect(body.history.map((event) => event.action)).toEqual(["account.export", "session.create"]);
  });

  test("effacer exige de retaper son login : sinon 400 et rien n'est effacé", async () => {
    const response = await call("/api/account/delete", { method: "POST", json: { confirmLogin: "someone-else" } });
    expect(response.status).toBe(400);
    expect(count("SELECT count(*) AS n FROM users")).toBe(1);
  });

  test("effacer supprime la personne et ses sessions, anonymise l'historique et révoque les jetons", async () => {
    const response = await call("/api/account/delete", { method: "POST", json: { confirmLogin: "OCTO-test" } });
    expect(response.status).toBe(204);
    expect(response.headers.getSetCookie().join()).toContain("pipliner_session=;");
    expect(count("SELECT count(*) AS n FROM users")).toBe(0);
    expect(count("SELECT count(*) AS n FROM sessions")).toBe(0);
    expect(count("SELECT count(*) AS n FROM audit_events WHERE actor_id IS NOT NULL OR target_id IS NOT NULL")).toBe(0);
    expect(actions()).toEqual(["session.create", "account.delete"]);
    expect(github.callsTo("DELETE", REVOKE_PATH)).toHaveLength(1);
    expect((await call("/api/session")).status).toBe(401);
  });
});
