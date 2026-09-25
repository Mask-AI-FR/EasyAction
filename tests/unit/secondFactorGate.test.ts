import "../support/testEnv.ts";
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { enrollDirectly, signInDirectly } from "../support/sessions.ts";
import { testDatabase } from "../support/testDatabase.ts";
import { buildApp } from "../../server/app.ts";
import { parseEnv } from "../../server/config/env.ts";
import { OPEN_BEFORE_SECOND_FACTOR } from "../../server/middleware/secondFactor.ts";
import { SETUP_ROUTES } from "../../server/routers/setup.ts";

const env = parseEnv(process.env);

beforeEach(() => {
  spyOn(process.stdout, "write").mockImplementation(() => true);
  spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  spyOn(process.stdout, "write").mockRestore();
  spyOn(process.stderr, "write").mockRestore();
});

/** Toutes les routes de l'API enregistrées (hors intergiciels `*`), avec un exemple d'adresse concrète. */
function apiRoutes(app: ReturnType<typeof buildApp>) {
  const seen = new Set<string>();
  return app.routes
    .filter((route) => route.method !== "ALL" && route.path.startsWith("/api/") && !route.path.includes("*"))
    .map((route) => ({
      key: `${route.method} ${route.path}`,
      method: route.method,
      sample: route.path.replace(/:(org|owner)\b/g, "Mask-AI-FR").replace(/:repo\b/, "repo").replace(/:[a-zA-Z]+/g, "1"),
    }))
    .filter((route) => !seen.has(route.key) && seen.add(route.key));
}

async function requestAs(app: ReturnType<typeof buildApp>, cookie: string, method: string, path: string) {
  return app.request(path, {
    method,
    headers: { Cookie: `pipliner_session=${cookie}`, Origin: env.appOrigin, "Content-Type": "application/json" },
    body: method === "GET" ? undefined : "{}",
  });
}

describe("garde du code du jour", () => {
  test("chaque route de l'API hors liste ouverte répond 403 second_factor_required, sans code du jour", async () => {
    const db = testDatabase();
    const app = buildApp(env, db);
    const setup = signInDirectly(env, db, { verified: false });
    const leaked: string[] = [];
    const routes = apiRoutes(app);
    expect(routes.length).toBeGreaterThan(10);
    for (const route of routes) {
      // Les routes d'installation répondent sans session, exprès (voir le dernier test).
      if (OPEN_BEFORE_SECOND_FACTOR.has(route.key) || SETUP_ROUTES.has(route.key)) continue;
      const response = await requestAs(app, setup, route.method, route.sample);
      const body = (await response.json().catch(() => null)) as { detail?: { code?: string } } | null;
      if (response.status !== 403 || body?.detail?.code !== "second_factor_required") leaked.push(`${route.key} → ${response.status}`);
    }
    expect(leaked).toEqual([]);
  });

  test("« code à saisir » (application en place, code pas encore donné) : même refus", async () => {
    const db = testDatabase();
    const app = buildApp(env, db);
    const cookie = signInDirectly(env, db, { verified: false });
    enrollDirectly(env, db);
    for (const path of ["/api/orgs", "/api/account/sessions", "/api/account/export"]) {
      expect((await requestAs(app, cookie, "GET", path)).status).toBe(403);
    }
  });

  test("la liste ouverte est exactement celle-ci, et ne nomme que des routes qui existent", () => {
    // L'élargir est une décision de sécurité : ce test doit alors changer, en connaissance de cause.
    expect([...OPEN_BEFORE_SECOND_FACTOR].sort()).toEqual([
      "GET /api/account/two-factor/enrollment/qr.svg",
      "GET /api/session",
      "POST /api/account/two-factor/enrollment",
      "POST /api/account/two-factor/enrollment/confirm",
      "POST /api/account/two-factor/verify",
    ]);
    const keys = new Set(apiRoutes(buildApp(env, testDatabase())).map((route) => route.key));
    for (const open of OPEN_BEFORE_SECOND_FACTOR) expect(keys.has(open)).toBe(true);
  });

  test("les routes d'installation sont exactement celles-ci : sans session, fermées (404) une fois installé", async () => {
    // Les élargir est une décision de sécurité : ce test doit alors changer, en connaissance de cause.
    expect([...SETUP_ROUTES].sort()).toEqual(["GET /api/setup", "POST /api/setup/github", "POST /api/setup/test"]);
    const app = buildApp(env, testDatabase());
    const keys = new Set(apiRoutes(app).map((route) => route.key));
    for (const open of SETUP_ROUTES) expect(keys.has(open)).toBe(true);
    for (const path of ["/api/setup/test", "/api/setup/github"]) {
      expect((await app.request(path, { method: "POST", headers: { Origin: env.appOrigin, "Content-Type": "application/json" }, body: "{}" })).status).toBe(404);
    }
  });

  test("les routes ouvertes répondent sans code du jour, et la déconnexion reste possible", async () => {
    const db = testDatabase();
    const app = buildApp(env, db);
    const cookie = signInDirectly(env, db, { verified: false });
    expect((await requestAs(app, cookie, "GET", "/api/session")).status).toBe(200);
    expect((await requestAs(app, cookie, "POST", "/api/account/two-factor/enrollment")).status).toBe(200);
    const logout = await app.request("/auth/logout", {
      method: "POST",
      headers: { Cookie: `pipliner_session=${cookie}`, Origin: env.appOrigin },
    });
    expect(logout.status).toBe(204);
  });
});
