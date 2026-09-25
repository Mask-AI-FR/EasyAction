/**
 * Migration 2 : le code à 6 chiffres d'une application d'authentification (TOTP), demandé chaque jour.
 *
 * - `sessions.second_factor_at` : dernier code accepté pour CETTE session (chaque navigateur le sien).
 * - `second_factors` : le secret confirmé (`secret_enc`) et, pendant une mise en place ou un changement
 *   d'application, le secret en attente (`pending_secret_enc`) — l'ancien reste valable tant que le
 *   nouveau n'est pas confirmé. `last_step` : dernier pas de 30 s accepté, pour qu'un code ne serve
 *   qu'une fois. `lock_level` : chaque nouveau blocage double la durée du précédent.
 * - `recovery_codes` : codes de secours à usage unique, gardés hachés (HMAC), jamais en clair.
 * Effacer une personne efface tout cela (CASCADE).
 */
export const migration0002 = {
  version: 2,
  name: "two_factor",
  dropsData: true,
  up: `
ALTER TABLE sessions ADD COLUMN second_factor_at INTEGER;

CREATE TABLE second_factors (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret_enc TEXT,
  confirmed_at INTEGER,
  pending_secret_enc TEXT,
  last_step INTEGER NOT NULL DEFAULT 0,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  lock_level INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER
) STRICT;

CREATE TABLE recovery_codes (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  used_at INTEGER,
  PRIMARY KEY (user_id, code_hash)
) STRICT;
`,
  down: `
DROP TABLE recovery_codes;
DROP TABLE second_factors;
ALTER TABLE sessions DROP COLUMN second_factor_at;
`,
} as const;
