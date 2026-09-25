import type { Database } from "bun:sqlite";

/**
 * Table `settings` : une ligne par réglage du site (clés du catalogue `domain/settingsCatalog.ts`),
 * valeur en texte ; le secret de l'app GitHub y est chiffré par l'appelant. Instants en secondes
 * depuis l'époque Unix (UTC).
 */
export interface SettingRecord {
  readonly key: string;
  readonly value: string;
  readonly updatedAt: number;
  readonly updatedBy: number | null;
}

interface SettingRow {
  readonly key: string;
  readonly value: string;
  readonly updated_at: number;
  readonly updated_by: number | null;
}

export function readAllSettings(db: Database): Map<string, SettingRecord> {
  const rows = db.query<SettingRow, []>("SELECT * FROM settings").all();
  return new Map(rows.map((row) => [row.key, { key: row.key, value: row.value, updatedAt: row.updated_at, updatedBy: row.updated_by }]));
}

/** Écrit (ou remplace) des réglages ; `actorId` : l'administrateur, ou `null` (ligne de commande). */
export function writeSettings(db: Database, entries: readonly (readonly [string, string])[], actorId: number | null, now: number): void {
  const upsert = db.query(
    `INSERT INTO settings (key, value, updated_at, updated_by) VALUES ($key, $value, $now, $actorId)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at,
       updated_by = excluded.updated_by`,
  );
  for (const [key, value] of entries) upsert.run({ key, value, now, actorId });
}

/** N'écrit que les réglages absents ; rend les clés écrites (import depuis `.env`, sans écraser le site). */
export function insertMissingSettings(db: Database, entries: readonly (readonly [string, string])[], now: number): string[] {
  const insert = db.query<{ key: string }, { key: string; value: string; now: number }>(
    "INSERT INTO settings (key, value, updated_at) VALUES ($key, $value, $now) ON CONFLICT (key) DO NOTHING RETURNING key",
  );
  return entries.flatMap(([key, value]) => insert.all({ key, value, now }).map((row) => row.key));
}
