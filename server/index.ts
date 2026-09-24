import { env } from "./config/env.ts";
import { buildApp, serveBuiltApp } from "./app.ts";
import { logger } from "./config/logger.ts";

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

const app = buildApp(env);
serveBuiltApp(app, APP_DIST);

Bun.serve({ hostname: env.host, port: env.port, fetch: app.fetch });
logger.info("service.started");
