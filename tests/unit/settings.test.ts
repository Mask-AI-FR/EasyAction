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
  clearGitHubConnection,
  completeSetup,
  isConfigured,
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

  test("sans connexion à GitHub : réglages illisibles, serveur en mode installation", () => {
    const db = bareDatabase();
    expect(() => readSettings(db, dataKey)).toThrow(SettingsMissingError);
    expect(isConfigured(db, dataKey)).toBe(false);
    expect(isConfigured(testDatabase(), dataKey)).toBe(true);
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
    const unpaired = { ...CONNECTION, webUrl: "https://github.com" };
    expect(() => saveGitHubConnection(db, dataKey, unpaired, withAdmin(db))).toThrow();
    expect(() => completeSetup(bareDatabase(), dataKey, unpaired)).toThrow();
    expect(readSettings(db, dataKey).github.webUrl).toBe(TEST_GITHUB.webUrl);
  });

  test("installation : la connexion enregistrée (secret chiffré), historique sans auteur, sessions restantes fermées", () => {
    const db = bareDatabase();
    const sessionCount = () => db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM sessions").get()?.n;
    signInDirectly(env, db);
    completeSetup(db, dataKey, CONNECTION);
    expect(readSettings(db, dataKey).github).toEqual({ ...CONNECTION, timeoutMs: 10_000 });
    expect(JSON.stringify(db.query("SELECT value FROM settings").all())).not.toContain(CONNECTION.clientSecret);
    expect(sessionCount()).toBe(0);
    const actions = db.query<{ action: string; actor_id: number | null }, []>("SELECT action, actor_id FROM audit_events ORDER BY id").all();
    expect(actions.slice(-2)).toEqual([
      { action: "settings.setup", actor_id: null },
      { action: "session.end_all", actor_id: null },
    ]);
  });

  test("remise à zéro (--reset) : connexion effacée, tout le monde déconnecté, retour à l'installation", () => {
    const db = testDatabase();
    signInDirectly(env, db);
    expect(clearGitHubConnection(db)).toBe(1);
    expect(isConfigured(db, dataKey)).toBe(false);
    expect(db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM sessions").get()?.n).toBe(0);
    const actions = db.query<{ action: string }, []>("SELECT action FROM audit_events ORDER BY id").all().map((row) => row.action);
    expect(actions).toContain("settings.reset");
    expect(actions.at(-1)).toBe("session.end_all");
    // Les plafonds, eux, restent : seule la connexion est effacée.
    expect(settingsBodyOf(db).limits.reposMax).toBe(1000);
  });
});
