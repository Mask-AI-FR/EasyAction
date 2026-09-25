import "../support/testEnv.ts";
import { afterAll, afterEach, beforeEach, describe, expect, setSystemTime, spyOn, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { FakeGitHub } from "../support/fakeGithub.ts";
import { codeFor, sessionStoreOf, signInDirectly } from "../support/sessions.ts";
import type { AdminUsersBody, HistoryBody } from "../../domain/adminContract.ts";
import type { SettingsBody } from "../../domain/settingsContract.ts";
import { buildApp } from "../../server/app.ts";
import { recordAuditEvent } from "../../server/repositories/auditEvents.ts";
import { deriveDataKey } from "../../server/security/dataCipher.ts";
import { changeRole } from "../../server/services/accountData.ts";
import { readSettings } from "../../server/services/settings.ts";

const github = new FakeGitHub();
const next = new FakeGitHub();
const env = github.env();
const ADMIN = { id: 7, login: "admin-test", avatarUrl: "https://avatars.githubusercontent.com/u/7" };
const MEMBER = { id: 8, login: "member-test", avatarUrl: "https://avatars.githubusercontent.com/u/8" };
let db: Database;
let app: ReturnType<typeof buildApp>;
let admin: string;
let member: string;

beforeEach(() => {
  setSystemTime(new Date("2026-09-25T08:00:10Z"));
  github.reset();
  next.reset();
  github.respond("DELETE", `/applications/${github.settings().clientId}/token`, () => new Response(null, { status: 204 }));
  github.respond("GET", "/meta", () => Response.json({ verifiable_password_authentication: false }));
  next.respond("GET", "/meta", () => Response.json({ verifiable_password_authentication: false }));
  db = github.database();
  app = buildApp(env, db);
  admin = signInDirectly(env, db, { owner: ADMIN });
  member = signInDirectly(env, db, { owner: MEMBER });
  changeRole(sessionStoreOf(env, db), ADMIN.id, "admin", null);
  spyOn(process.stdout, "write").mockImplementation(() => true);
  spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  setSystemTime();
  spyOn(process.stdout, "write").mockRestore();
  spyOn(process.stderr, "write").mockRestore();
});

afterAll(() => {
  github.stop();
  next.stop();
});

/** Le code du pas suivant : chaque code ne sert qu'une fois, chaque test en consomme plusieurs. */
function freshCode(): string {
  setSystemTime(new Date(Date.now() + 30_000));
  return codeFor();
}

function call(cookie: string, path: string, method: "GET" | "POST" | "PUT" = "GET", json?: unknown) {
  const headers: Record<string, string> = { Cookie: `pipliner_session=${cookie}`, Origin: env.appOrigin };
  if (json !== undefined) headers["Content-Type"] = "application/json";
  return app.request(path, { method, headers, body: json === undefined ? undefined : JSON.stringify(json) });
}

const errorCode = async (response: Response) => ((await response.json()) as { detail: { code: string; message: string } }).detail;
const sessionsOf = (id: number) => db.query<{ n: number }, [number]>("SELECT count(*) AS n FROM sessions WHERE user_id = ?").get(id)?.n;

describe("page Settings", () => {
  test("un membre reçoit 403 sur toute la zone d'administration", async () => {
    for (const path of ["/api/admin/settings", "/api/admin/users", "/api/admin/history"]) {
      expect((await call(member, path)).status).toBe(403);
    }
  });

  test("les réglages : connexion sans le secret, plafonds", async () => {
    const response = await call(admin, "/api/admin/settings");
    const text = await response.text();
    expect(text).not.toContain(github.settings().clientSecret);
    const body = JSON.parse(text) as SettingsBody;
    expect(body.github).toMatchObject({ webUrl: github.url, clientSecretSet: true });
    expect(body.limits.dispatchMaxTargets).toBe(50);
  });

  test("un plafond hors bornes est refusé et nommé ; un bon s'applique dès la requête suivante", async () => {
    const refused = await call(admin, "/api/admin/settings/limits", "PUT", { values: { reposMax: 0 } });
    expect(refused.status).toBe(400);
    expect((await errorCode(refused)).message).toContain("reposMax");
    expect((await call(admin, "/api/admin/settings/limits", "PUT", { values: { dispatchMaxTargets: 7 } })).status).toBe(200);
    const session = (await (await call(member, "/api/session")).json()) as { limits: { dispatchMaxTargets: number } };
    expect(session.limits.dispatchMaxTargets).toBe(7);
  });

  test("test de connexion : paire refusée en disant l'adresse attendue ; le faux GitHub répond ; rien ne répond", async () => {
    const unpaired = await call(admin, "/api/admin/settings/github/test", "POST", { webUrl: "https://github.com", apiUrl: next.url });
    expect((await errorCode(unpaired)).message).toContain("https://api.github.com");
    const ok = await call(admin, "/api/admin/settings/github/test", "POST", { webUrl: next.url, apiUrl: next.url });
    expect(await ok.json()).toEqual({ ok: true, message: "GitHub answers at this address." });
    const closed = await call(admin, "/api/admin/settings/github/test", "POST", { webUrl: "http://127.0.0.1:1", apiUrl: "http://127.0.0.1:1" });
    expect(((await closed.json()) as { ok: boolean }).ok).toBe(false);
    expect(next.callsTo("GET", "/meta")[0]?.headers.get("authorization")).toBeNull();
  });

  test("enregistrer la connexion exige un code actuel", async () => {
    const connection = { webUrl: next.url, apiUrl: next.url, clientId: "Iv1.next", clientSecret: "next-secret", code: "000000" };
    const response = await call(admin, "/api/admin/settings/github", "PUT", connection);
    expect((await errorCode(response)).code).toBe("invalid_code");
    expect(readSettings(db, deriveDataKey(env.dataEncryptionKey)).github.webUrl).toBe(github.url);
  });

  test("changer d'adresse ferme TOUTES les sessions et révoque les jetons avec l'ANCIENNE app", async () => {
    const connection = { webUrl: next.url, apiUrl: next.url, clientId: "Iv1.next", clientSecret: "next-secret", code: freshCode() };
    const response = await call(admin, "/api/admin/settings/github", "PUT", connection);
    expect(await response.json()).toEqual({ signedEveryoneOut: true });
    expect(response.headers.getSetCookie().join()).toContain("pipliner_session=;");
    expect(db.query("SELECT count(*) AS n FROM sessions").get()).toEqual({ n: 0 });
    const revocations = github.callsTo("DELETE", `/applications/${github.settings().clientId}/token`);
    expect(revocations).toHaveLength(2);
    expect(revocations[0]?.headers.get("authorization")).toBe(`Basic ${btoa(`${github.settings().clientId}:${github.settings().clientSecret}`)}`);
    expect(readSettings(db, deriveDataKey(env.dataEncryptionKey)).github).toMatchObject({ webUrl: next.url, clientId: "Iv1.next" });
  });

  test("remplacer seulement le secret garde les sessions (mêmes jetons, même app)", async () => {
    const { webUrl, apiUrl, clientId } = github.settings();
    const response = await call(admin, "/api/admin/settings/github", "PUT", { webUrl, apiUrl, clientId, clientSecret: "rotated", code: freshCode() });
    expect(await response.json()).toEqual({ signedEveryoneOut: false });
    expect(sessionsOf(MEMBER.id)).toBe(1);
  });
});

describe("page Users", () => {
  test("liste : rôle, code du jour en place, navigateurs connectés", async () => {
    const body = (await (await call(admin, "/api/admin/users")).json()) as AdminUsersBody;
    expect(body.users.map((user) => [user.login, user.role, user.twoFactorEnabled, user.sessions])).toEqual([
      ["admin-test", "admin", true, 1],
      ["member-test", "member", true, 1],
    ]);
  });

  test("rôle : code exigé ; jamais sans administrateur", async () => {
    expect((await call(admin, `/api/admin/users/${MEMBER.id}/role`, "POST", { role: "admin", code: "000000" })).status).toBe(400);
    expect((await call(admin, `/api/admin/users/${ADMIN.id}/role`, "POST", { role: "member", code: freshCode() })).status).toBe(400);
    expect((await call(admin, `/api/admin/users/${MEMBER.id}/role`, "POST", { role: "admin", code: freshCode() })).status).toBe(204);
    expect((await call(admin, `/api/admin/users/${ADMIN.id}/role`, "POST", { role: "member", code: freshCode() })).status).toBe(204);
  });

  test("retirer le code du jour de quelqu'un, fermer ses sessions, l'effacer ; jamais soi-même", async () => {
    expect((await call(admin, `/api/admin/users/${MEMBER.id}/reset-two-factor`, "POST", { code: freshCode() })).status).toBe(204);
    expect(((await (await call(member, "/api/session")).json()) as { secondFactor: string }).secondFactor).toBe("setup");
    expect(await (await call(admin, `/api/admin/users/${MEMBER.id}/sign-out`, "POST", {})).json()).toEqual({ ended: 1 });
    expect(sessionsOf(MEMBER.id)).toBe(0);
    expect((await call(admin, `/api/admin/users/${ADMIN.id}/delete`, "POST", { code: freshCode() })).status).toBe(400);
    expect((await call(admin, `/api/admin/users/${MEMBER.id}/delete`, "POST", { code: freshCode() })).status).toBe(204);
    expect(db.query("SELECT count(*) AS n FROM users WHERE id = ?").get(MEMBER.id)).toEqual({ n: 0 });
  });
});

describe("page History", () => {
  test("du plus récent au plus ancien, par pages de 50, filtrable, avec les logins", async () => {
    for (let index = 0; index < 55; index++) recordAuditEvent(db, { action: "account.export", actorId: MEMBER.id, targetId: null }, index);
    const first = (await (await call(admin, "/api/admin/history")).json()) as HistoryBody;
    expect(first.entries).toHaveLength(50);
    expect(first.entries[0]?.id).toBeGreaterThan(first.entries[1]?.id ?? 0);
    const second = (await (await call(admin, `/api/admin/history?before=${first.nextBefore}`)).json()) as HistoryBody;
    expect(second.nextBefore).toBeNull();
    const exports = (await (await call(admin, "/api/admin/history?action=account.export")).json()) as HistoryBody;
    expect(exports.entries.every((entry) => entry.action === "account.export" && entry.actor === "member-test")).toBe(true);
    expect((await call(admin, "/api/admin/history?action=nope")).status).toBe(400);
  });
});
