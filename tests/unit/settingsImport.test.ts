import "../support/testEnv.ts";
import { afterAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabase } from "../../server/db/database.ts";
import { migrateUp } from "../../server/db/migrator.ts";

const SCRIPT = new URL("../../scripts/settings.ts", import.meta.url).pathname;
const dir = await mkdtemp(join(tmpdir(), "pipliner-import-"));
afterAll(() => rm(dir, { recursive: true, force: true }));

/** Toutes les variables lues par l'import, posées explicitement (aucune ne vient d'un vrai `.env`). */
const GITHUB_ENV = {
  GITHUB_WEB_URL: "http://127.0.0.1:9",
  GITHUB_API_URL: "http://127.0.0.1:9",
  GITHUB_APP_CLIENT_ID: "Iv1.imported",
  GITHUB_APP_CLIENT_SECRET: "imported-secret-value",
  GITHUB_TIMEOUT_MS: "",
  REPOS_MAX: "",
  BRANCHES_MAX: "",
  ACTIVE_BRANCH_DAYS: "",
  DISPATCH_MAX_TARGETS: "",
  DISPATCH_CONCURRENCY: "",
  RUN_POLL_MIN_SECONDS: "",
  RUN_TRACK_MAX_MINUTES: "",
};

function bareDatabase(name: string): string {
  const path = join(dir, name);
  const db = createDatabase(path);
  migrateUp(db);
  db.close();
  return path;
}

/** Lancée depuis un dossier temporaire : Bun n'y trouve aucun `.env` à charger. */
function runImport(path: string, overrides: Record<string, string>, ...args: string[]) {
  const result = Bun.spawnSync(["bun", SCRIPT, "import-env", ...args], {
    cwd: dir,
    env: { ...process.env, ...GITHUB_ENV, ...overrides, DATABASE_PATH: path },
  });
  return { exitCode: result.exitCode, output: result.stdout.toString() };
}

const valueOf = (path: string, key: string) => {
  const db = new Database(path, { readonly: true });
  const row = db.query<{ value: string }, [string]>("SELECT value FROM settings WHERE key = ?").get(key);
  db.close();
  return row?.value;
};

describe("bun run settings:import-env", () => {
  test("importe la connexion à GitHub et les plafonds de .env, en n'affichant que des noms", () => {
    const path = bareDatabase("first.sqlite");
    const { exitCode, output } = runImport(path, { REPOS_MAX: "12" });
    expect(exitCode).toBe(0);
    expect(output).toContain("githubClientSecret");
    expect(output).not.toContain("imported-secret-value");
    expect(valueOf(path, "githubClientId")).toBe("Iv1.imported");
    expect(valueOf(path, "githubClientSecret")).toStartWith("v1.");
    expect(valueOf(path, "reposMax")).toBe("12");
  });

  test("n'écrase jamais ce que le site a réglé, sauf --replace", () => {
    const path = bareDatabase("again.sqlite");
    runImport(path, { REPOS_MAX: "12" });
    expect(runImport(path, { REPOS_MAX: "99" }).output).toContain("Nothing to import");
    expect(valueOf(path, "reposMax")).toBe("12");
    expect(runImport(path, { REPOS_MAX: "99" }, "--replace").exitCode).toBe(0);
    expect(valueOf(path, "reposMax")).toBe("99");
  });

  test("une paire d'adresses qui ne va pas, ou un plafond hors bornes : rien n'est écrit, code 1", () => {
    const path = bareDatabase("invalid.sqlite");
    expect(runImport(path, { GITHUB_API_URL: "https://api.github.com" }).exitCode).toBe(1);
    const bad = runImport(path, { REPOS_MAX: "0" });
    expect(bad.exitCode).toBe(1);
    expect(bad.output).toContain("reposMax");
    expect(valueOf(path, "githubWebUrl")).toBeUndefined();
  });

  test("connexion incomplète dans .env : la commande dit ce qui manque, code 1", () => {
    const path = bareDatabase("partial.sqlite");
    const { exitCode, output } = runImport(path, { GITHUB_WEB_URL: "", GITHUB_API_URL: "", GITHUB_APP_CLIENT_ID: "", GITHUB_APP_CLIENT_SECRET: "" });
    expect(exitCode).toBe(1);
    expect(output).toContain("Still missing");
  });
});
