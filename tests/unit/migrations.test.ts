import { afterAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configureDatabase, createDatabase, openDatabase, schemaStateOf } from "../../server/db/database.ts";
import {
  LATEST_VERSION,
  MIGRATIONS,
  migrateDown,
  migrateUp,
  schemaVersion,
  type Migration,
} from "../../server/db/migrator.ts";

const dir = await mkdtemp(join(tmpdir(), "pipliner-db-"));
afterAll(() => rm(dir, { recursive: true, force: true }));

function memory(): Database {
  const db = new Database(":memory:", { strict: true });
  configureDatabase(db);
  return db;
}

/** Tables et index de l'application (les tables internes `sqlite_*` sont exclues). */
function schemaOf(db: Database): string[] {
  return db
    .query<{ sql: string }, []>(
      "SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map((row) => row.sql);
}

/** Colonnes (nom, type, nullité, défaut) et index de chaque table : indépendant de la mise en forme du SQL. */
function structureOf(db: Database): Record<string, unknown> {
  const tables = db
    .query<{ name: string }, []>("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((row) => row.name);
  const indexes = db
    .query<{ name: string }, []>("SELECT name FROM sqlite_schema WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((row) => row.name);
  return { indexes, ...Object.fromEntries(tables.map((table) => [table, db.query(`PRAGMA table_info(${table})`).all()])) };
}

describe("migrations", () => {
  test("versions 1, 2, 3… dans l'ordre et sans trou : la dernière est LATEST_VERSION", () => {
    expect(MIGRATIONS.map((migration) => migration.version)).toEqual(MIGRATIONS.map((_, index) => index + 1));
    expect(LATEST_VERSION).toBe(MIGRATIONS.length);
  });

  test("montée complète : les tables existent, la version est à jour, une seconde montée ne fait rien", () => {
    const db = memory();
    expect(migrateUp(db)).toEqual(MIGRATIONS.map((migration) => migration.version));
    expect(schemaVersion(db)).toBe(LATEST_VERSION);
    const tables = db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map((row) => row.name);
    expect(tables).toEqual(["audit_events", "recovery_codes", "second_factors", "sessions", "settings", "users"]);
    expect(migrateUp(db)).toEqual([]);
  });

  test("chaque descente défait sa montée : montée → descente → montée redonne le même schéma", () => {
    const db = memory();
    migrateUp(db);
    const first = schemaOf(db);
    expect(migrateDown(db, 0)).toEqual([...MIGRATIONS].reverse().map((migration) => migration.version));
    expect(schemaVersion(db)).toBe(0);
    expect(schemaOf(db)).toEqual([]);
    migrateUp(db);
    expect(schemaOf(db)).toEqual(first);
  });

  test("chaque migration se défait seule : la descente d'un cran redonne exactement la structure d'avant", () => {
    for (const migration of MIGRATIONS) {
      const db = memory();
      migrateUp(db, MIGRATIONS.slice(0, migration.version - 1));
      const before = structureOf(db);
      migrateUp(db, MIGRATIONS.slice(0, migration.version));
      expect(migrateDown(db, migration.version - 1)).toEqual([migration.version]);
      expect(structureOf(db)).toEqual(before);
    }
  });

  test("une migration qui échoue ne laisse ni demi-schéma ni numéro de version menteur", () => {
    const db = memory();
    const broken: Migration = {
      version: LATEST_VERSION + 1,
      name: "cassée",
      dropsData: false,
      up: "CREATE TABLE demi (x INTEGER); SELECT * FROM table_absente;",
      down: "DROP TABLE demi;",
    };
    expect(() => migrateUp(db, [...MIGRATIONS, broken])).toThrow();
    expect(schemaVersion(db)).toBe(LATEST_VERSION);
    expect(db.query("SELECT name FROM sqlite_schema WHERE name = 'demi'").all()).toEqual([]);
  });

  test("effacer une personne efface ses sessions (CASCADE) et anonymise son historique (SET NULL)", () => {
    const db = memory();
    migrateUp(db);
    db.run("INSERT INTO users (id, login, avatar_url, created_at, last_sign_in_at) VALUES (1, 'a', 'x', 0, 0)");
    db.run(
      `INSERT INTO sessions (id_hash, user_id, created_at, last_seen_at, expires_at, token_generation,
         access_token_enc, access_expires_at, refresh_token_enc, refresh_expires_at)
       VALUES ('h', 1, 0, 0, 9, 1, 'v1.a', 0, 'v1.b', 0)`,
    );
    db.run("INSERT INTO second_factors (user_id, secret_enc) VALUES (1, 'v1.c')");
    db.run("INSERT INTO recovery_codes (user_id, code_hash) VALUES (1, 'x')");
    db.run("INSERT INTO audit_events (at, action, actor_id, target_id) VALUES (0, 'session.create', 1, 1)");
    db.run("DELETE FROM users WHERE id = 1");
    expect(db.query("SELECT count(*) AS n FROM sessions").get()).toEqual({ n: 0 });
    expect(db.query("SELECT count(*) AS n FROM second_factors").get()).toEqual({ n: 0 });
    expect(db.query("SELECT count(*) AS n FROM recovery_codes").get()).toEqual({ n: 0 });
    expect(db.query("SELECT actor_id, target_id FROM audit_events").get()).toEqual({ actor_id: null, target_id: null });
  });
});

describe("ouverture de la base par le serveur (échec fermé au démarrage)", () => {
  test("fichier absent : refus de démarrer, avec la commande à lancer", () => {
    const path = join(dir, "absente.sqlite");
    expect(schemaStateOf(path)).toBe("missing");
    expect(() => openDatabase(path)).toThrow(/bun run db:migrate/);
  });

  test("schéma pas à la version du code : refus de démarrer", () => {
    const path = join(dir, "ancienne.sqlite");
    createDatabase(path).close();
    expect(schemaStateOf(path)).toBe("outdated");
    expect(() => openDatabase(path)).toThrow(`version 0, ce code attend la version ${LATEST_VERSION}`);
  });

  test("base migrée : ouverte, avec les clés étrangères actives", () => {
    const path = join(dir, "prete.sqlite");
    const created = createDatabase(path);
    migrateUp(created);
    created.close();
    expect(schemaStateOf(path)).toBe("ready");
    const db = openDatabase(path);
    expect(db.query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    expect(db.query("PRAGMA secure_delete").get()).toEqual({ secure_delete: 1 });
    db.close();
  });

  test("le dossier est créé en 0700 et, sous le masque 077 des commandes, le fichier en 0600", () => {
    const folder = join(dir, "donnees");
    const path = join(folder, "base.sqlite");
    const previous = process.umask(0o077);
    try {
      createDatabase(path).close();
    } finally {
      process.umask(previous);
    }
    expect(statSync(folder).mode & 0o777).toBe(0o700);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });
});
