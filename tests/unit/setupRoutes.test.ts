import "../support/testEnv.ts";
import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { Database } from "bun:sqlite";
import { FakeGitHub } from "../support/fakeGithub.ts";
import { testDatabase } from "../support/testDatabase.ts";
import type { ApiErrorBody } from "../../domain/apiContract.ts";
import { buildApp } from "../../server/app.ts";
import { issueSetupCode } from "../../server/auth/setupCode.ts";
import { parseEnv } from "../../server/config/env.ts";
import { configureDatabase } from "../../server/db/database.ts";
import { migrateUp } from "../../server/db/migrator.ts";
import { deriveDataKey, deriveSetupCodeKey } from "../../server/security/dataCipher.ts";
import { readSettings } from "../../server/services/settings.ts";

const env = parseEnv(process.env);
const github = new FakeGitHub();

beforeEach(() => spyOn(process.stdout, "write").mockImplementation(() => true));
afterEach(() => {
  spyOn(process.stdout, "write").mockRestore();
  github.reset();
});
afterAll(() => github.stop());

/** Base migrée sans aucun réglage : le serveur est en mode installation. */
function bareDatabase(): Database {
  const db = new Database(":memory:", { strict: true });
  configureDatabase(db);
  migrateUp(db);
  return db;
}

const validCode = () => issueSetupCode(deriveSetupCodeKey(env.dataEncryptionKey), Math.floor(Date.now() / 1000)).code;
const answersLikeGitHub = () => github.respond("GET", "/meta", () => Response.json({ verifiable_password_authentication: false }));

function post(app: ReturnType<typeof buildApp>, path: string, body: unknown, origin: string | null = env.appOrigin) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (origin) headers.Origin = origin;
  return app.request(path, { method: "POST", headers, body: JSON.stringify(body) });
}

const connection = () => ({ webUrl: github.url, apiUrl: github.url, clientId: "Iv1.setup-test", clientSecret: "setup-test-secret" });
const errorCode = async (response: Response) => ((await response.json()) as ApiErrorBody).detail.code;

describe("mode installation (aucune connexion à GitHub)", () => {
  test("toute l'API répond 503 setup_required, /auth renvoie vers /setup, /health reste ouvert", async () => {
    const app = buildApp(env, bareDatabase());
    for (const path of ["/api/session", "/api/orgs", "/api/admin/settings"]) {
      const response = await app.request(path);
      expect(response.status).toBe(503);
      expect(await errorCode(response)).toBe("setup_required");
    }
    const login = await app.request("/auth/login");
    expect(login.status).toBe(303);
    expect(login.headers.get("location")).toBe("/setup");
    expect((await app.request("/health")).status).toBe(200);
    expect(await (await app.request("/api/setup")).json()).toEqual({ required: true });
  });

  test("sans code valable : 400 invalid_code, GitHub n'est pas appelé, rien n'est enregistré", async () => {
    answersLikeGitHub();
    const db = bareDatabase();
    const app = buildApp(env, db);
    const test = await post(app, "/api/setup/test", { setupCode: "AAAA-BBBB-CCCC-DDDD-EEEE-FFFF", webUrl: github.url, apiUrl: github.url });
    expect(test.status).toBe(400);
    expect(await errorCode(test)).toBe("invalid_code");
    const save = await post(app, "/api/setup/github", { ...connection(), setupCode: "wrong" });
    expect(save.status).toBe(400);
    expect(github.calls).toHaveLength(0);
    expect(db.query("SELECT key FROM settings").all()).toEqual([]);
  });

  test("code valable : test puis enregistrement (secret chiffré, historique sans auteur), puis l'installation se ferme", async () => {
    answersLikeGitHub();
    const db = bareDatabase();
    const app = buildApp(env, db);
    const setupCode = validCode();
    const tested = await post(app, "/api/setup/test", { setupCode, webUrl: github.url, apiUrl: github.url });
    expect(await tested.json()).toEqual({ ok: true, message: "GitHub answers at this address." });
    expect((await post(app, "/api/setup/github", { ...connection(), setupCode })).status).toBe(204);
    expect(readSettings(db, deriveDataKey(env.dataEncryptionKey)).github).toMatchObject({ clientId: "Iv1.setup-test", clientSecret: "setup-test-secret" });
    expect(JSON.stringify(db.query("SELECT value FROM settings").all())).not.toContain("setup-test-secret");
    expect(db.query("SELECT action, actor_id FROM audit_events").all()).toContainEqual({ action: "settings.setup", actor_id: null });
    expect(await (await app.request("/api/setup")).json()).toEqual({ required: false });
    const again = await post(app, "/api/setup/github", { ...connection(), clientId: "Iv1.someone-else", setupCode });
    expect(again.status).toBe(404);
    expect(readSettings(db, deriveDataKey(env.dataEncryptionKey)).github.clientId).toBe("Iv1.setup-test");
    expect((await app.request("/api/session")).status).toBe(401);
  });

  test("adresses qui ne vont pas ensemble, ou GitHub absent à l'adresse : 400, rien d'enregistré", async () => {
    const db = bareDatabase();
    const app = buildApp(env, db);
    const unpaired = await post(app, "/api/setup/github", { ...connection(), webUrl: "https://github.com", setupCode: validCode() });
    expect(unpaired.status).toBe(400);
    github.respond("GET", "/meta", () => new Response("", { status: 404 }));
    const notGitHub = await post(app, "/api/setup/github", { ...connection(), setupCode: validCode() });
    expect(notGitHub.status).toBe(400);
    expect(db.query("SELECT key FROM settings").all()).toEqual([]);
  });

  test("sans l'Origin exacte de l'app : 403", async () => {
    const app = buildApp(env, bareDatabase());
    const response = await post(app, "/api/setup/github", { ...connection(), setupCode: validCode() }, "https://evil.example");
    expect(response.status).toBe(403);
  });

  test("serveur déjà installé : l'installation répond 404, même avec un code valable", async () => {
    answersLikeGitHub();
    const app = buildApp(env, testDatabase());
    expect((await post(app, "/api/setup/test", { setupCode: validCode(), webUrl: github.url, apiUrl: github.url })).status).toBe(404);
    expect((await post(app, "/api/setup/github", { ...connection(), setupCode: validCode() })).status).toBe(404);
    expect(github.calls).toHaveLength(0);
  });
});
