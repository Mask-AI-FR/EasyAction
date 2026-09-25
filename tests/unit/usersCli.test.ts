import "../support/testEnv.ts";
import { afterAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enrollDirectly, signInDirectly } from "../support/sessions.ts";
import { parseEnv } from "../../server/config/env.ts";
import { createDatabase } from "../../server/db/database.ts";
import { migrateUp } from "../../server/db/migrator.ts";

const SCRIPT = new URL("../../scripts/users.ts", import.meta.url).pathname;
const dir = await mkdtemp(join(tmpdir(), "pipliner-users-"));
afterAll(() => rm(dir, { recursive: true, force: true }));

/** Une base sur disque avec une personne connectée et son application d'authentification. */
function preparedDatabase(name: string): string {
  const path = join(dir, name);
  const db = createDatabase(path);
  migrateUp(db);
  const env = parseEnv({ ...process.env, DATABASE_PATH: path });
  signInDirectly(env, db);
  enrollDirectly(env, db);
  db.close();
  return path;
}

/** Lancée depuis un dossier temporaire : Bun n'y trouve aucun `.env` à charger. */
function runUsers(path: string, ...args: string[]) {
  const result = Bun.spawnSync(["bun", SCRIPT, ...args], {
    cwd: dir,
    env: { ...process.env, DATABASE_PATH: path },
  });
  return { exitCode: result.exitCode, output: result.stdout.toString() };
}

describe("bun run users:promote / users:demote", () => {
  test("le premier administrateur se crée en ligne de commande, et il en reste toujours un", () => {
    const path = preparedDatabase("roles.sqlite");
    const promoted = runUsers(path, "promote", "octo-test");
    expect(promoted.exitCode).toBe(0);
    expect(promoted.output).toContain("octo-test is now an administrator");
    const refused = runUsers(path, "demote", "octo-test");
    expect(refused.exitCode).toBe(1);
    expect(refused.output).toContain("Keep at least one administrator");
    const db = new Database(path, { readonly: true });
    expect(db.query("SELECT role FROM users WHERE id = 42").get()).toEqual({ role: "admin" });
    expect(db.query("SELECT actor_id FROM audit_events WHERE action = 'user.role_change'").get()).toEqual({ actor_id: null });
    db.close();
  });
});

describe("bun run users:reset-two-factor", () => {
  test("retire l'application d'authentification d'une personne, inscrit à l'historique sans auteur", () => {
    const path = preparedDatabase("reset.sqlite");
    const { exitCode, output } = runUsers(path, "reset-two-factor", "OCTO-TEST");
    expect(exitCode).toBe(0);
    expect(output).toContain("Authenticator app removed for octo-test");
    const db = new Database(path, { readonly: true });
    expect(db.query("SELECT count(*) AS n FROM second_factors").get()).toEqual({ n: 0 });
    expect(db.query("SELECT count(*) AS n FROM sessions WHERE second_factor_at IS NOT NULL").get()).toEqual({ n: 0 });
    expect(db.query("SELECT action, actor_id, target_id FROM audit_events ORDER BY id DESC LIMIT 1").get()).toEqual({
      action: "two_factor.reset",
      actor_id: null,
      target_id: 42,
    });
    db.close();
  });

  test("login inconnu : rien n'est touché, code de sortie 1", () => {
    const path = preparedDatabase("unknown.sqlite");
    const { exitCode, output } = runUsers(path, "reset-two-factor", "someone-else");
    expect(exitCode).toBe(1);
    expect(output).toContain("No EasyActions user named someone-else");
  });

  test("sans argument : l'usage est rappelé, code de sortie 2", () => {
    expect(runUsers(join(dir, "none.sqlite"), "reset-two-factor").exitCode).toBe(2);
  });
});
