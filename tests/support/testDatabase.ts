import { Database } from "bun:sqlite";
import type { GitHubSettings } from "../../server/config/env.ts";
import { configureDatabase } from "../../server/db/database.ts";
import { migrateUp } from "../../server/db/migrator.ts";
import { writeSettings } from "../../server/repositories/settings.ts";
import { deriveDataKey, sealValue } from "../../server/security/dataCipher.ts";

/**
 * Connexion à GitHub des tests, par défaut : un port fermé (un appel réseau imprévu échoue tout de
 * suite au lieu de sortir) et des identifiants fictifs. Les tests à faux GitHub passent la leur
 * (`FakeGitHub.database()`).
 */
export const TEST_GITHUB: GitHubSettings = {
  webUrl: "http://127.0.0.1:1",
  apiUrl: "http://127.0.0.1:1",
  clientId: "Iv1.not-a-real-client",
  clientSecret: "not-a-real-client-secret",
  timeoutMs: 2000,
};

/**
 * Base SQLite EN MÉMOIRE au schéma courant (réglages du serveur, migrations appliquées), avec la
 * connexion à GitHub en réglages du site : chaque test a la sienne, rien n'est écrit sur disque. Les
 * réglages sont posés sans passer par l'historique, pour ne pas fausser les tests qui le lisent.
 */
export function testDatabase(github: GitHubSettings = TEST_GITHUB): Database {
  const secret = process.env.DATA_ENCRYPTION_KEY;
  if (!secret) throw new Error("Import tests/support/testEnv.ts before tests/support/testDatabase.ts");
  const db = new Database(":memory:", { strict: true });
  configureDatabase(db);
  migrateUp(db);
  const sealed = sealValue(deriveDataKey(secret), "settings.github_client_secret", "githubClientSecret", github.clientSecret);
  writeSettings(
    db,
    [
      ["githubWebUrl", github.webUrl],
      ["githubApiUrl", github.apiUrl],
      ["githubClientId", github.clientId],
      ["githubClientSecret", sealed],
      ["githubTimeoutMs", String(github.timeoutMs)],
    ],
    null,
    Math.floor(Date.now() / 1000),
  );
  return db;
}
