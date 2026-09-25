import type { Database } from "bun:sqlite";
import { migration0001 } from "./migrations/0001_sessions.ts";
import { migration0002 } from "./migrations/0002_two_factor.ts";
import { migration0003 } from "./migrations/0003_settings.ts";

/**
 * Migrations du schéma SQLite. Seule la commande `bun run db:migrate` les applique : jamais le
 * démarrage du serveur (CLAUDE.md §6.2), qui se contente de vérifier la version (db/database.ts) —
 * même partage que les services MaskAI (migration à part, vérification au démarrage).
 *
 * La version du schéma est `PRAGMA user_version`, écrite DANS la transaction de la migration : un
 * échec au milieu ne laisse ni demi-schéma ni numéro menteur (vérifié sur Bun 1.3.11). Chaque
 * migration a sa descente, testée (tests/unit/migrations.test.ts).
 * Une future migration qui reconstruit une table devra couper les clés étrangères HORS transaction
 * (SQLite ignore ce réglage dans une transaction) et finir par `PRAGMA foreign_key_check`.
 */
export interface Migration {
  readonly version: number;
  readonly name: string;
  /** Sa descente efface des données : `bun run db:rollback` exige alors `--yes`. */
  readonly dropsData: boolean;
  readonly up: string;
  readonly down: string;
}

/** Liste explicite et ordonnée (aucune lecture de dossier) : versions 1, 2, 3… sans trou. */
export const MIGRATIONS: readonly Migration[] = [migration0001, migration0002, migration0003];

export const LATEST_VERSION = MIGRATIONS.length;

export function schemaVersion(db: Database): number {
  return db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version ?? 0;
}

/** Applique, dans l'ordre, les migrations au-delà de la version courante ; rend celles appliquées. */
export function migrateUp(db: Database, migrations: readonly Migration[] = MIGRATIONS): number[] {
  const applied: number[] = [];
  for (const migration of migrations) {
    if (migration.version <= schemaVersion(db)) continue;
    db.transaction(() => {
      db.run(migration.up);
      // Entier venu du code, pas d'une saisie : un PRAGMA n'accepte pas de paramètre lié.
      db.run(`PRAGMA user_version = ${migration.version}`);
    })();
    applied.push(migration.version);
  }
  return applied;
}

/** Descend jusqu'à la version `target`, de la plus récente à la plus ancienne ; rend celles retirées. */
export function migrateDown(
  db: Database,
  target: number,
  migrations: readonly Migration[] = MIGRATIONS,
): number[] {
  const removed: number[] = [];
  for (const migration of [...migrations].reverse()) {
    if (migration.version > schemaVersion(db) || migration.version <= target) continue;
    db.transaction(() => {
      db.run(migration.down);
      db.run(`PRAGMA user_version = ${migration.version - 1}`);
    })();
    removed.push(migration.version);
  }
  return removed;
}
