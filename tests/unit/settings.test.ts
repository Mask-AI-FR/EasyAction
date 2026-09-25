import "../support/testEnv.ts";
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { signInDirectly } from "../support/sessions.ts";
import { TEST_GITHUB, testDatabase } from "../support/testDatabase.ts";
import { parseEnv } from "../../server/config/env.ts";
import { configureDatabase } from "../../server/db/database.ts";
import { migrateUp } from "../../server/db/migrator.ts";
import { upsertSignedInUser } from "../../server/repositories/users.ts";
import { deriveDataKey } from "../../server/security/dataCipher.ts";
import {
  assertSettingsReady,
  importSettings,
  readSettings,
  saveGitHubConnection,
  settingsBodyOf,
  SettingsMissingError,
  updateLimits,
} from "../../server/services/settings.ts";

const env = parseEnv(process.env);
const dataKey = deriveDataKey(env.dataEncryptionKey);
const CONNECTION = { webUrl: TEST_GITHUB.webUrl, apiUrl: TEST_GITHUB.apiUrl, clientId: TEST_GITHUB.clientId, clientSecret: TEST_GITHUB.clientSecret };

/** Base migrée, SANS aucun réglage (comme juste après `bun run db:migrate`). */
function bareDatabase(): Database {
  const db = new Database(":memory:", { strict: true });
  configureDatabase(db);
  migrateUp(db);
  return db;
}

function withAdmin(db: Database): number {
  upsertSignedInUser(db, { id: 7, login: "admin-test", avatarUrl: "https://avatars.githubusercontent.com/u/7" }, 0);
  return 7;
}

const lastAudit = (db: Database) =>
  db.query<{ action: string; detail: string | null }, []>("SELECT action, detail FROM audit_events ORDER BY id DESC LIMIT 1").get();

describe("réglages du site", () => {
  test("lus en base : connexion à GitHub, et plafonds par défaut quand rien n'est enregistré", () => {
    const settings = readSettings(testDatabase(), dataKey);
    expect(settings.github).toEqual(TEST_GITHUB);
    expect(settings.limits.reposMax).toBe(1000);
    expect(settings.limits.dispatchMaxTargets).toBe(50);
  });

  test("sans connexion à GitHub : refus de démarrer, qui nomme les réglages et la commande, jamais une valeur", () => {
    const db = bareDatabase();
    expect(() => readSettings(db, dataKey)).toThrow(SettingsMissingError);
    expect(() => assertSettingsReady(db, dataKey)).toThrow(/settings:import-env/);
  });

  test("secret illisible (DATA_ENCRYPTION_KEY changée) : même refus, sur le secret", () => {
    const other = deriveDataKey("another-data-key-that-is-long-enough-000");
    try {
      readSettings(testDatabase(), other);
      throw new Error("aucun échec");
    } catch (err) {
      expect((err as SettingsMissingError).missing).toEqual(["githubClientSecret"]);
    }
  });

  test("la vue de la page Settings ne contient jamais le secret, seulement sa présence", () => {
    const body = settingsBodyOf(testDatabase());
    expect(JSON.stringify(body)).not.toContain(TEST_GITHUB.clientSecret);
    expect(body.github).toMatchObject({ webUrl: TEST_GITHUB.webUrl, clientId: TEST_GITHUB.clientId, clientSecretSet: true });
  });

  test("plafonds : écrits avec l'historique (noms seulement), valables à la lecture suivante", () => {
    const db = testDatabase();
    updateLimits(db, { reposMax: 42 }, withAdmin(db));
    expect(readSettings(db, dataKey).limits.reposMax).toBe(42);
    expect(lastAudit(db)).toEqual({ action: "settings.update", detail: JSON.stringify({ keys: ["reposMax"] }) });
  });

  test("connexion : adresse ou identifiant changés → changement d'identité ; secret seul → non", () => {
    const db = testDatabase();
    const admin = withAdmin(db);
    expect(saveGitHubConnection(db, dataKey, { ...CONNECTION, clientSecret: "rotated-secret" }, admin).changedIdentity).toBe(false);
    expect(readSettings(db, dataKey).github.clientSecret).toBe("rotated-secret");
    expect(saveGitHubConnection(db, dataKey, { ...CONNECTION, clientId: "Iv1.other" }, admin).changedIdentity).toBe(true);
    expect(JSON.stringify(db.query("SELECT value FROM settings").all())).not.toContain("rotated-secret");
  });

  test("une paire d'adresses qui ne va pas n'est jamais enregistrée", () => {
    const db = testDatabase();
    expect(() => saveGitHubConnection(db, dataKey, { ...CONNECTION, webUrl: "https://github.com" }, null)).toThrow();
    expect(readSettings(db, dataKey).github.webUrl).toBe(TEST_GITHUB.webUrl);
  });

  test("import depuis .env : n'écrase pas ce que le site a réglé ; --replace le fait", () => {
    const db = bareDatabase();
    expect(importSettings(db, dataKey, { github: CONNECTION, limits: { reposMax: 10 } }, false).written.sort()).toEqual(
      ["githubApiUrl", "githubClientId", "githubClientSecret", "githubWebUrl", "reposMax"],
    );
    expect(importSettings(db, dataKey, { github: null, limits: { reposMax: 20 } }, false).written).toEqual([]);
    expect(readSettings(db, dataKey).limits.reposMax).toBe(10);
    expect(importSettings(db, dataKey, { github: null, limits: { reposMax: 20 } }, true).written).toEqual(["reposMax"]);
    expect(readSettings(db, dataKey).limits.reposMax).toBe(20);
    expect(lastAudit(db)?.action).toBe("settings.import");
  });

  test("--replace vers une autre app ou une autre adresse : tout le monde est déconnecté, comme sur la page Settings", () => {
    const db = testDatabase();
    const sessionCount = () => db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM sessions").get()?.n;
    signInDirectly(env, db);
    const sameApp = importSettings(db, dataKey, { github: { ...CONNECTION, clientSecret: "rotated-secret" }, limits: {} }, true);
    expect(sameApp.signedEveryoneOut).toBe(false);
    expect(sessionCount()).toBe(1);
    const otherApp = importSettings(db, dataKey, { github: { ...CONNECTION, clientId: "Iv1.other" }, limits: {} }, true);
    expect(otherApp.signedEveryoneOut).toBe(true);
    expect(sessionCount()).toBe(0);
    expect(lastAudit(db)?.action).toBe("session.end_all");
  });
});
