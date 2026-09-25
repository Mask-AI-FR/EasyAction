import { readdirSync } from "node:fs";
import { env } from "./config/env.ts";
import appPage from "../app/index.html";
import { buildApp, listenOptions } from "./app.ts";
import { logger } from "./config/logger.ts";
import { openDatabase } from "./db/database.ts";
import { deriveDataKey } from "./security/dataCipher.ts";
import { purgeExpiredData } from "./services/sessions.ts";
import { isConfigured } from "./services/settings.ts";

/**
 * Point d'entrée de DÉVELOPPEMENT (`bun run dev` = `bun --hot server/dev.ts`).
 *
 * Bun bundle `app/index.html` à la volée (plugin Tailwind déclaré dans bunfig.toml) et recharge à
 * chaud. Ses routes d'import HTML ne portent pas d'en-têtes personnalisés : la page n'a donc PAS de
 * CSP ici — acceptable sur 127.0.0.1, jamais en production (voir `server/index.ts`).
 * Priorité des routes Bun : exacte > paramètre > joker (`/api/*`) > joker global (`/*`).
 */
// Fichiers créés par ce processus (base SQLite, journaux `-wal`/`-shm`) : lisibles par son seul
// propriétaire. SQLite n'a pas d'option de mode, et DATABASE_PATH peut viser n'importe quel dossier.
process.umask(0o077);
const db = openDatabase(env.databasePath);
// Sans connexion à GitHub, le serveur démarre quand même, en mode installation (seul /setup répond).
if (!isConfigured(db, deriveDataKey(env.dataEncryptionKey))) logger.warn("setup.required", { route: "/setup" });
purgeExpiredData(db, env.auditRetentionDays);

const app = buildApp(env, db);
const viaHono = (request: Request): Response | Promise<Response> =>
  app.fetch(request);

/**
 * Icônes de l'application installable, à l'adresse fixe que nomme le manifeste (`/icons/…`). En
 * production, `scripts/buildApp.ts` les copie dans dist/app ; ici, on les lit dans app/public/icons.
 * Seuls les fichiers présents au démarrage sont servis : aucun chemin venu de la requête n'atteint
 * le disque.
 */
const ICONS_DIR = new URL("../app/public/icons/", import.meta.url);
const ICON_FILES = new Set(readdirSync(ICONS_DIR));

function serveIcon(request: Bun.BunRequest<"/icons/:file">): Response {
  const { file } = request.params;
  if (!ICON_FILES.has(file)) return new Response("Not found", { status: 404 });
  return new Response(Bun.file(new URL(file, ICONS_DIR)), { headers: { "Cache-Control": "no-cache" } });
}

Bun.serve({
  ...listenOptions(env),
  development: true,
  routes: {
    "/health": viaHono,
    "/api/*": viaHono,
    "/auth/*": viaHono,
    "/icons/:file": serveIcon,
    "/*": appPage,
  },
  fetch: viaHono,
});
logger.info("service.started");
