import { env } from "../server/config/env.ts";
import { createDatabase, schemaStateOf } from "../server/db/database.ts";
import { LATEST_VERSION, MIGRATIONS, migrateDown, migrateUp, schemaVersion } from "../server/db/migrator.ts";

/**
 * Commandes d'exploitation de la base SQLite (`DATABASE_PATH`). À lancer serveur ARRÊTÉ : l'attente
 * de verrou de bun:sqlite bloquerait sa boucle d'événements.
 *   bun run db:migrate          applique les migrations manquantes (crée la base au besoin)
 *   bun run db:rollback         retire la dernière migration ; `--yes` si elle efface des données
 *   bun run db:status           version du schéma
 */
const say = (line: string): void => void process.stdout.write(`${line}\n`);

function migrate(): number {
  const db = createDatabase(env.databasePath);
  try {
    const applied = migrateUp(db);
    say(applied.length > 0 ? `Applied migration(s) ${applied.join(", ")}.` : "Database already up to date.");
    say(`Schema version ${schemaVersion(db)} of ${LATEST_VERSION}.`);
    return 0;
  } finally {
    db.close();
  }
}

/** ÉCHEC FERMÉ : une descente qui efface des tables exige `--yes`, tapé en connaissance de cause. */
function rollback(confirmed: boolean): number {
  if (schemaStateOf(env.databasePath) === "missing") {
    say("No database yet: nothing to roll back.");
    return 1;
  }
  const db = createDatabase(env.databasePath);
  try {
    const current = schemaVersion(db);
    const migration = MIGRATIONS[current - 1];
    if (!migration) {
      say("Nothing to roll back.");
      return 0;
    }
    if (migration.dropsData && !confirmed) {
      say(`Rolling back migration ${migration.version} (${migration.name}) deletes its tables and their data.`);
      say("Stop the server, back up the database file, then run: bun run db:rollback --yes");
      return 1;
    }
    migrateDown(db, current - 1);
    say(`Rolled back migration ${migration.version} (${migration.name}). Schema version ${schemaVersion(db)}.`);
    return 0;
  } finally {
    db.close();
  }
}

function status(): number {
  const state = schemaStateOf(env.databasePath);
  const advice: Record<typeof state, string> = {
    missing: "No database yet. Run: bun run db:migrate",
    outdated: "The schema is not the one this code expects. Stop the server, then run: bun run db:migrate",
    ready: `Database ready (schema version ${LATEST_VERSION}).`,
  };
  say(advice[state]);
  return state === "ready" ? 0 : 1;
}

if (import.meta.main) {
  // Fichiers créés ici (base, journaux) : lisibles par leur seul propriétaire, comme au serveur.
  process.umask(0o077);
  const [command, ...args] = process.argv.slice(2);
  if (command === "migrate") process.exit(migrate());
  if (command === "rollback") process.exit(rollback(args.includes("--yes")));
  if (command === "status") process.exit(status());
  say("Usage: bun run db:migrate | db:rollback [--yes] | db:status");
  process.exit(2);
}
