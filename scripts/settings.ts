import { env } from "../server/config/env.ts";
import { openDatabase } from "../server/db/database.ts";
import { checkLimitChanges, type LimitSettingKey } from "../domain/settingsCatalog.ts";
import { GitHubConnectionFields } from "../server/schemas/settings.schema.ts";
import { PLACEHOLDER } from "../server/schemas/env.schema.ts";
import { deriveDataKey } from "../server/security/dataCipher.ts";
import { importSettings, readSettings, SettingsMissingError } from "../server/services/settings.ts";

/**
 * `bun run settings:import-env` : copie en base les réglages du site encore donnés par `.env` (connexion
 * à GitHub, plafonds), une première fois — ensuite la page Settings fait foi. N'écrit que les réglages
 * absents ; `--replace` les remplace (récupération : clé de chiffrement changée, connexion cassée).
 * Serveur arrêté. N'affiche que des NOMS, jamais une valeur (le secret de l'app est parmi elles).
 */
const say = (line: string): void => void process.stdout.write(`${line}\n`);

/** Nom de variable d'environnement → réglage (seul endroit où ces noms sont encore lus). */
const LIMIT_VARIABLES: Readonly<Record<string, LimitSettingKey>> = {
  GITHUB_TIMEOUT_MS: "githubTimeoutMs",
  REPOS_MAX: "reposMax",
  BRANCHES_MAX: "branchesMax",
  ACTIVE_BRANCH_DAYS: "activeBranchDays",
  DISPATCH_MAX_TARGETS: "dispatchMaxTargets",
  DISPATCH_CONCURRENCY: "dispatchConcurrency",
  RUN_POLL_MIN_SECONDS: "runPollMinSeconds",
  RUN_TRACK_MAX_MINUTES: "runTrackMaxMinutes",
};
const GITHUB_VARIABLES = ["GITHUB_WEB_URL", "GITHUB_API_URL", "GITHUB_APP_CLIENT_ID", "GITHUB_APP_CLIENT_SECRET"] as const;

const given = (name: string): string | undefined => {
  const value = process.env[name]?.trim();
  return value && value !== PLACEHOLDER ? value : undefined;
};

/** La connexion à GitHub de `.env`, les quatre ensemble ; `undefined` si elle n'y est pas, `null` si invalide. */
function githubFromEnv() {
  if (GITHUB_VARIABLES.every((name) => !given(name))) return undefined;
  const parsed = GitHubConnectionFields.safeParse({
    webUrl: given("GITHUB_WEB_URL"),
    apiUrl: given("GITHUB_API_URL"),
    clientId: given("GITHUB_APP_CLIENT_ID"),
    clientSecret: given("GITHUB_APP_CLIENT_SECRET"),
  });
  return parsed.success ? parsed.data : null;
}

function importEnv(replace: boolean): number {
  const github = githubFromEnv();
  if (github === null) {
    say(`Invalid GitHub connection in .env: set all of ${GITHUB_VARIABLES.join(", ")}; the API address must match the web address.`);
    return 1;
  }
  const raw = Object.fromEntries(
    Object.entries(LIMIT_VARIABLES).flatMap(([name, key]) => (given(name) ? [[key, Number(given(name))]] : [])),
  );
  const { accepted, invalid } = checkLimitChanges(raw);
  if (invalid.length > 0) {
    say(`Invalid value in .env for: ${invalid.join(", ")} (see .env.example for the ranges).`);
    return 1;
  }
  const db = openDatabase(env.databasePath);
  try {
    const dataKey = deriveDataKey(env.dataEncryptionKey);
    const { written, signedEveryoneOut } = importSettings(db, dataKey, { github: github ?? null, limits: accepted }, replace);
    say(written.length > 0 ? `Imported: ${written.join(", ")}.` : "Nothing to import: the database already has these settings.");
    if (signedEveryoneOut) say("The GitHub address or client ID changed: everybody was signed out.");
    readSettings(db, dataKey);
    say("GitHub connection ready. From now on, change it on the Settings page.");
    return 0;
  } catch (err) {
    if (!(err instanceof SettingsMissingError)) throw err;
    say(`Still missing: ${err.missing.join(", ")}. Put ${GITHUB_VARIABLES.join(", ")} in .env and run this again.`);
    return 1;
  } finally {
    db.close();
  }
}

if (import.meta.main) {
  // Fichiers éventuellement créés ici (journaux SQLite) : lisibles par leur seul propriétaire.
  process.umask(0o077);
  const [command, ...args] = process.argv.slice(2);
  if (command === "import-env") process.exit(importEnv(args.includes("--replace")));
  say("Usage: bun run settings:import-env [--replace]");
  process.exit(2);
}
