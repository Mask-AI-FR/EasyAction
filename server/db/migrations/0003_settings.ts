/**
 * Migration 3 : la configuration réglable depuis le site (page Settings des administrateurs) —
 * connexion à GitHub (adresses, identifiant et secret de l'app) et plafonds. Une ligne par réglage ;
 * le secret de l'app y est chiffré. `updated_by` devient NULL si l'administrateur est effacé.
 * Les réglages de sécurité (sessions, code du jour, historique) restent dans `.env` : décision du
 * mainteneur, un administrateur ne peut pas les affaiblir depuis le site.
 */
export const migration0003 = {
  version: 3,
  name: "settings",
  dropsData: true,
  up: `
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL
) STRICT;
`,
  down: `
DROP TABLE settings;
`,
} as const;
