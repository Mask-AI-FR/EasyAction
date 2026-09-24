import "../support/testEnv.ts";
import { describe, expect, test } from "bun:test";
import { parseEnv } from "../../server/config/env.ts";

const VALID = {
  HOST: "127.0.0.1",
  PORT: "8094",
  APP_ORIGIN: "http://127.0.0.1:8094",
  SESSION_SECRET: "not-a-real-secret-only-for-tests-000000",
  GITHUB_WEB_URL: "https://github.com/",
  GITHUB_API_URL: "https://api.github.com",
  GITHUB_APP_CLIENT_ID: "Iv1.not-a-real-client",
  GITHUB_APP_CLIENT_SECRET: "not-a-real-client-secret",
  GITHUB_TIMEOUT_MS: "10000",
  REPOS_MAX: "1000",
  BRANCHES_MAX: "300",
  ACTIVE_BRANCH_DAYS: "90",
  DISPATCH_MAX_TARGETS: "50",
  DISPATCH_CONCURRENCY: "3",
  RUN_POLL_MIN_SECONDS: "10",
  RUN_TRACK_MAX_MINUTES: "30",
};

function failureOf(source: Record<string, string>): string {
  try {
    parseEnv(source);
  } catch (err) {
    return err instanceof Error ? err.message : "";
  }
  return "";
}

describe("parseEnv", () => {
  test("refuse de démarrer et nomme toutes les variables manquantes d'un coup", () => {
    expect(() => parseEnv({})).toThrow(/HOST, PORT, APP_ORIGIN, SESSION_SECRET/);
  });

  test("dit comment corriger sans pousser à écraser un .env existant (et ses secrets)", () => {
    expect(() => parseEnv({})).toThrow(/Ajoutez-les à votre \.env/);
    expect(() => parseEnv({})).toThrow(/sans \.env encore : copiez \.env\.example vers \.env/);
  });

  test("refuse un plafond de dépôts nul", () => {
    expect(failureOf({ ...VALID, REPOS_MAX: "0" })).toContain("invalide(s) : REPOS_MAX");
  });

  test("considère une valeur vide, ou laissée à <TO_PROVIDE>, comme manquante", () => {
    expect(failureOf({ ...VALID, HOST: "  " })).toContain("manquante(s) : HOST");
    expect(failureOf({ ...VALID, GITHUB_APP_CLIENT_SECRET: "<TO_PROVIDE>" })).toContain(
      "manquante(s) : GITHUB_APP_CLIENT_SECRET",
    );
  });

  test("refuse un PORT hors plage en nommant la variable, jamais sa valeur", () => {
    const message = failureOf({ ...VALID, PORT: "70000" });
    expect(message).toContain("invalide(s) : PORT");
    expect(message).not.toContain("70000");
  });

  test("refuse un secret de session trop court, sans jamais l'afficher", () => {
    const message = failureOf({ ...VALID, SESSION_SECRET: "court-mais-secret" });
    expect(message).toContain("invalide(s) : SESSION_SECRET");
    expect(message).not.toContain("court-mais-secret");
  });

  test("n'admet http que vers la boucle locale : un cookie ou un jeton ne circule jamais en clair", () => {
    expect(failureOf({ ...VALID, APP_ORIGIN: "http://pipliner.example.org" })).toContain(
      "invalide(s) : APP_ORIGIN",
    );
    expect(failureOf({ ...VALID, GITHUB_API_URL: "http://api.github.com" })).toContain(
      "invalide(s) : GITHUB_API_URL",
    );
    expect(failureOf({ ...VALID, APP_ORIGIN: "https://pipliner.example.org" })).toBe("");
  });

  test("APP_ORIGIN est une origine nue : un chemin est refusé", () => {
    expect(failureOf({ ...VALID, APP_ORIGIN: "http://127.0.0.1:8094/app" })).toContain(
      "invalide(s) : APP_ORIGIN",
    );
  });

  test("renvoie une configuration typée, adresses GitHub sans barre finale", () => {
    expect(parseEnv(VALID)).toEqual({
      host: "127.0.0.1",
      port: 8094,
      appOrigin: "http://127.0.0.1:8094",
      sessionSecret: "not-a-real-secret-only-for-tests-000000",
      github: {
        webUrl: "https://github.com",
        apiUrl: "https://api.github.com",
        clientId: "Iv1.not-a-real-client",
        clientSecret: "not-a-real-client-secret",
        timeoutMs: 10_000,
      },
      limits: {
        reposMax: 1000,
        branchesMax: 300,
        activeBranchDays: 90,
        dispatchMaxTargets: 50,
        dispatchConcurrency: 3,
        runPollMinSeconds: 10,
        runTrackMaxMinutes: 30,
      },
    });
  });
});
