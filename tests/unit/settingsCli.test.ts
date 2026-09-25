import "../support/testEnv.ts";
import { afterAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signInDirectly } from "../support/sessions.ts";
import { TEST_GITHUB } from "../support/testDatabase.ts";
import { checkSetupCode } from "../../server/auth/setupCode.ts";
import { parseEnv } from "../../server/config/env.ts";
import { createDatabase } from "../../server/db/database.ts";
import { migrateUp } from "../../server/db/migrator.ts";
import { deriveDataKey, deriveSetupCodeKey } from "../../server/security/dataCipher.ts";
import { completeSetup, isConfigured } from "../../server/services/settings.ts";

const SCRIPT = new URL("../../scripts/settings.ts", import.meta.url).pathname;
const env = parseEnv(process.env);
const dataKey = deriveDataKey(env.dataEncryptionKey);
const dir = await mkdtemp(join(tmpdir(), "pipliner-setup-code-"));
afterAll(() => rm(dir, { recursive: true, force: true }));

/** Base migrée dans un fichier ; `connected` y enregistre une connexion à GitHub et une session. */
function databaseFile(name: string, connected: boolean): string {
  const path = join(dir, name);
  const db = createDatabase(path);
  migrateUp(db);
  if (connected) {
    const { timeoutMs: _timeout, ...connection } = TEST_GITHUB;
    completeSetup(db, dataKey, connection);
    signInDirectly(env, db);
  }
  db.close();
  return path;
}

/** Lancée depuis un dossier temporaire, variables posées explicitement : aucun vrai `.env` n'est lu. */
function run(path: string, ...args: string[]) {
  const result = Bun.spawnSync(["bun", SCRIPT, ...args], { cwd: dir, env: { ...process.env, DATABASE_PATH: path } });
  return { exitCode: result.exitCode, output: result.stdout.toString() };
}

const codeIn = (output: string) => /Setup code: ([A-Z2-7-]+)/.exec(output)?.[1] ?? "";

describe("bun run settings:setup-code", () => {
  test("sans connexion : affiche un code que le serveur accepte, et l'adresse de la page /setup", () => {
    const { exitCode, output } = run(databaseFile("fresh.sqlite", false), "setup-code");
    expect(exitCode).toBe(0);
    expect(checkSetupCode(deriveSetupCodeKey(env.dataEncryptionKey), codeIn(output), Math.floor(Date.now() / 1000))).toBe(true);
    expect(output).toContain(`${env.appOrigin}/setup`);
  });

  test("déjà installé : refuse, sans aucun code, et dit comment recommencer", () => {
    const { exitCode, output } = run(databaseFile("configured.sqlite", true), "setup-code");
    expect(exitCode).toBe(1);
    expect(codeIn(output)).toBe("");
    expect(output).toContain("settings:setup-code --reset");
  });

  test("--reset : connexion effacée, tout le monde déconnecté, puis un code", () => {
    const path = databaseFile("reset.sqlite", true);
    const { exitCode, output } = run(path, "setup-code", "--reset");
    expect(exitCode).toBe(0);
    expect(output).toContain("Signed out: 1 session.");
    expect(codeIn(output)).not.toBe("");
    const db = new Database(path, { readonly: true });
    expect(isConfigured(db, dataKey)).toBe(false);
    expect(db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM sessions").get()?.n).toBe(0);
    expect(db.query("SELECT action FROM audit_events WHERE action = 'settings.reset'").all()).toHaveLength(1);
    db.close();
  });

  test("sans commande : l'usage, sortie 2", () => {
    const { exitCode, output } = run(databaseFile("usage.sqlite", false));
    expect(exitCode).toBe(2);
    expect(output).toContain("bun run settings:setup-code [--reset]");
  });
});
