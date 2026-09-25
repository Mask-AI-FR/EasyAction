/**
 * Migration 1 : personnes, sessions « rester connecté » et historique.
 *
 * - Tables STRICT : SQLite refuse un texte dans une colonne INTEGER au lieu de le garder tel quel.
 * - Instants en secondes depuis l'époque Unix (UTC), comparés directement en SQL.
 * - `users.id` = l'identifiant numérique GitHub : un login peut changer, pas lui.
 * - `sessions.id_hash` = SHA-256 du cookie : une fuite de la base ne donne aucun cookie utilisable, et
 *   les jetons GitHub y sont chiffrés (`*_enc`, server/security/dataCipher.ts).
 * - Effacer une personne efface ses sessions (CASCADE) et anonymise son historique (SET NULL) : c'est
 *   le chemin d'effacement exigé par CLAUDE.md §7. `detail` ne contient jamais d'identifiant ni de login,
 *   sinon ils survivraient à cet effacement.
 */
export const migration0001 = {
  version: 1,
  name: "sessions",
  dropsData: true,
  up: `
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  login TEXT NOT NULL,
  avatar_url TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
  created_at INTEGER NOT NULL,
  last_sign_in_at INTEGER NOT NULL
) STRICT;

CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  token_generation INTEGER NOT NULL,
  access_token_enc TEXT NOT NULL,
  access_expires_at INTEGER NOT NULL,
  refresh_token_enc TEXT NOT NULL,
  refresh_expires_at INTEGER NOT NULL
) STRICT;
CREATE INDEX sessions_by_user ON sessions(user_id, created_at);
CREATE INDEX sessions_by_expiry ON sessions(expires_at);

CREATE TABLE audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  action TEXT NOT NULL,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  target_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  detail TEXT
) STRICT;
CREATE INDEX audit_events_by_time ON audit_events(at);
CREATE INDEX audit_events_by_actor ON audit_events(actor_id);
CREATE INDEX audit_events_by_target ON audit_events(target_id);
`,
  down: `
DROP TABLE audit_events;
DROP TABLE sessions;
DROP TABLE users;
`,
} as const;
