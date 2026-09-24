import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { secureHeaders } from "hono/secure-headers";
import { cookiePolicyFor, deriveSessionKey } from "./auth/sessionCookie.ts";
import type { PiplinerEnv } from "./config/env.ts";
import { renderError, renderNotFound } from "./exceptions/errorHandler.ts";
import { apiRouter } from "./routers/api.ts";
import { authRouter, type AuthDeps } from "./routers/auth.ts";
import { healthRouter } from "./routers/health.ts";

/**
 * Application Hono sans effet de bord au chargement, testable par `app.request()` (motif des services
 * Org/Billing). La configuration est passée en paramètre : les tests fournissent la leur (faux GitHub).
 * Les points d'entrée y ajoutent le service de la SPA (`index.ts`) ou le délèguent à Bun (`dev.ts`).
 */
export function buildApp(env: PiplinerEnv): Hono {
  const deps: AuthDeps = {
    env,
    key: deriveSessionKey(env.sessionSecret),
    cookies: cookiePolicyFor(env.appOrigin),
  };
  const app = new Hono();
  app.use("*", secureHeaders(securityHeadersFor(env)));
  app.route("/", healthRouter);
  app.route("/auth", authRouter(deps));
  app.route("/api", apiRouter(deps));
  // Une adresse d'API ou d'authentification inconnue répond en JSON, jamais par la page de l'app.
  app.all("/api/*", renderNotFound);
  app.all("/auth/*", renderNotFound);
  app.onError(renderError);
  return app;
}

/** Page d'entrée : toujours revalidée, sinon un navigateur garde l'ancienne après un déploiement. */
const REVALIDATE = "no-cache";
/** Fichiers au nom haché (`chunk-<hash>.js|css`) : leur contenu ne change jamais sous ce nom. */
const IMMUTABLE = "public, max-age=31536000, immutable";

/**
 * Sert l'application pré-construite (production), après les routes de `buildApp`. Toute adresse qui
 * n'est ni un fichier ni une route d'API rend la page d'entrée, dont le routeur choisit la page.
 * Cache : constaté au navigateur (M2), une page d'entrée périmée gardée en cache pointait vers des
 * fichiers hachés disparus, et l'application ne démarrait plus.
 */
export function serveBuiltApp(app: Hono, distDir: string): void {
  app.use(
    "*",
    serveStatic({
      root: distDir,
      onFound: (path, c) => {
        c.header("Cache-Control", /\/chunk-[a-z0-9]+\.(?:js|css)$/.test(path) ? IMMUTABLE : REVALIDATE);
      },
    }),
  );
  // `root` + `path` relatif : Hono joint toujours `path` à `root` (par défaut `./`), si bien qu'un
  // `path` absolu devenait relatif au dossier courant et la page d'entrée introuvable.
  app.get(
    "*",
    serveStatic({
      root: distDir,
      path: "index.html",
      onFound: (_path, c) => {
        c.header("Cache-Control", REVALIDATE);
      },
    }),
  );
}

/**
 * En-têtes de sécurité de toute réponse Hono (l'API, et en production la page de l'application).
 * - `frame-ancestors 'none'` + `X-Frame-Options: DENY` : un bouton « Run pipelines » qui déclenche des
 *   déploiements ne doit jamais pouvoir être encadré par un autre site (clickjacking).
 * - Pas de `upgrade-insecure-requests` : il casserait l'usage local en http://127.0.0.1.
 * - `font-src data:` : le bundler CSS de Bun incruste les polices en `data:` sans option pour l'éviter
 *   (scripts/buildApp.ts) ; ces données viennent de notre propre CSS, jamais d'une saisie utilisateur.
 * - `img-src` : les avatars GitHub, et rien d'autre venant d'ailleurs.
 */
function securityHeadersFor(env: PiplinerEnv) {
  return {
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      baseUri: ["'none'"],
      fontSrc: ["'self'", "data:"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      imgSrc: ["'self'", ...avatarSources(env.github.webUrl)],
      objectSrc: ["'none'"],
    },
    xFrameOptions: "DENY",
    referrerPolicy: "same-origin",
  } satisfies Parameters<typeof secureHeaders>[0];
}

/**
 * Origines des avatars : github.com les sert depuis avatars.githubusercontent.com ; un GitHub
 * Enterprise Server depuis sa propre origine, ou `avatars.<hôte>` si l'isolation de sous-domaines
 * est active.
 */
function avatarSources(webUrl: string): string[] {
  const { host, origin } = new URL(webUrl);
  return host === "github.com"
    ? ["https://avatars.githubusercontent.com"]
    : [origin, `https://avatars.${host}`];
}
