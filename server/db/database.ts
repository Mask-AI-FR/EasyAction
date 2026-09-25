import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database, SQLiteError } from "bun:sqlite";
import { LATEST_VERSION, schemaVersion } from "./migrator.ts";

/**
 * Accès au fichier SQLite de Pipliner (`DATABASE_PATH`). Le serveur OUVRE une base existante dont il
 * vérifie la version ; seule `bun run db:migrate` la crée et la fait évoluer (CLAUDE.md §6.2).
 * Les requêtes vivent dans `server/repositories/` (un module par table), nulle part ailleurs.
 */

/**
 * Réglages de chaque connexion.
 * - `foreign_keys` est désactivé par défaut dans SQLite : sans lui, ni CASCADE ni SET NULL, et effacer
 *   une personne laisserait ses sessions (chemin d'effacement, CLAUDE.md §7).
 * - `secure_delete` écrase les pages libérées : un jeton supprimé ne reste pas lisible dans le fichier.
 * - `busy_timeout` : une commande d'exploitation qui écrit au même moment fait attendre, pas échouer.
 */
export function configureDatabase(db: Database): void {
  db.run("PRAGMA foreign_keys = ON");
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA busy_timeout = 5000");
  db.run("PRAGMA secure_delete = ON");
}

export type SchemaState = "missing" | "outdated" | "ready";

/** État du schéma, sans rien créer ni modifier (`bun run db:status`, `bun run desktop`). */
export function schemaStateOf(path: string): SchemaState {
  let db: Database;
  try {
    db = new Database(path, { readonly: true });
  } catch (err) {
    if (err instanceof SQLiteError) return "missing";
    throw err;
  }
  try {
    return schemaVersion(db) === LATEST_VERSION ? "ready" : "outdated";
  } finally {
    db.close();
  }
}

/**
 * Base du serveur. ÉCHEC FERMÉ AU DÉMARRAGE : fichier absent ou schéma pas à la version de ce code →
 * le serveur refuse de démarrer et dit quelle commande lancer. Le message nomme la variable, pas le
 * chemin.
 */
export function openDatabase(path: string): Database {
  let db: Database;
  try {
    db = new Database(path, { readwrite: true, create: false, strict: true });
  } catch (err) {
    if (!(err instanceof SQLiteError)) throw err;
    throw new Error(
      "Pipliner refuse de démarrer : la base de données (DATABASE_PATH) est introuvable. " +
        "Lancez `bun run db:migrate` d'abord.",
    );
  }
  const version = schemaVersion(db);
  if (version !== LATEST_VERSION) {
    db.close();
    throw new Error(
      `Pipliner refuse de démarrer : le schéma de la base est en version ${version}, ce code attend ` +
        `la version ${LATEST_VERSION}. Arrêtez le serveur, puis lancez \`bun run db:migrate\`.`,
    );
  }
  configureDatabase(db);
  return db;
}

/**
 * Base de `bun run db:migrate` : crée le dossier (0700 : il couvre aussi les fichiers `-wal`/`-shm`)
 * et le fichier au besoin. Le masque de création 077 est posé par la commande avant l'appel.
 */
export function createDatabase(path: string): Database {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new Database(path, { readwrite: true, create: true, strict: true });
  configureDatabase(db);
  return db;
}
