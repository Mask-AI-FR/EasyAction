import { env } from "./config/env.ts";
import { buildApp, listenOptions, serveBuiltApp } from "./app.ts";
import { logger } from "./config/logger.ts";
import { openDatabase } from "./db/database.ts";
import { deriveDataKey } from "./security/dataCipher.ts";
import { purgeExpiredData } from "./services/sessions.ts";
import { isConfigured } from "./services/settings.ts";

/**
 * Point d'entrée de PRODUCTION (`bun run start`, depuis la racine du dépôt : les chemins en dépendent).
 *
 * La SPA pré-construite (`bun run build` → dist/app) est servie À TRAVERS Hono pour que chaque
 * réponse, page comprise, porte les en-têtes de sécurité : les routes d'import HTML de Bun n'acceptent
 * pas d'en-têtes personnalisés, et `frame-ancestors` ne peut pas venir d'une CSP en <meta>.
 */
const APP_DIST = "./dist/app";

// ÉCHEC FERMÉ AU DÉMARRAGE : sans build, chaque page répondrait 404 sans que rien ne le signale.
if (!(await Bun.file(`${APP_DIST}/index.html`).exists())) {
  throw new Error(
    "Pipliner refuse de démarrer : dist/app/index.html est absent. Lancez `bun run build` d'abord.",
  );
}

// Fichiers créés par ce processus (base SQLite, journaux `-wal`/`-shm`) : lisibles par son seul
// propriétaire. SQLite n'a pas d'option de mode, et DATABASE_PATH peut viser n'importe quel dossier.
process.umask(0o077);
const db = openDatabase(env.databasePath);
// Sans connexion à GitHub, le serveur démarre quand même, en mode installation (seul /setup répond).
if (!isConfigured(db, deriveDataKey(env.dataEncryptionKey))) logger.warn("setup.required", { route: "/setup" });
purgeExpiredData(db, env.auditRetentionDays);

const app = buildApp(env, db);
serveBuiltApp(app, APP_DIST);

Bun.serve({ ...listenOptions(env), fetch: app.fetch });
logger.info("service.started");
