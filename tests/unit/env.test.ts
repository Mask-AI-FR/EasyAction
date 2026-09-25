import "../support/testEnv.ts";
import { describe, expect, test } from "bun:test";
import { parseEnv } from "../../server/config/env.ts";

const VALID = {
  HOST: "127.0.0.1",
  PORT: "8094",
  APP_ORIGIN: "http://127.0.0.1:8094",
  SESSION_SECRET: "not-a-real-secret-only-for-tests-000000",
  DATA_ENCRYPTION_KEY: "not-a-real-data-key-only-for-tests-00000",
  DATABASE_PATH: "./data/pipliner.sqlite",
  HTTP_IDLE_TIMEOUT_SECONDS: "240",
  SESSION_MAX_DAYS: "30",
  SESSIONS_PER_USER_MAX: "5",
  AUDIT_RETENTION_DAYS: "365",
  TWO_FACTOR_EVERY_HOURS: "24",
  TWO_FACTOR_MAX_ATTEMPTS: "5",
  TWO_FACTOR_LOCK_MINUTES: "15",
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

  test("la connexion à GitHub et les plafonds ne sont plus exigés au démarrage : ce sont des réglages du site", () => {
    expect(failureOf(VALID)).toBe("");
    expect(parseEnv(VALID)).not.toHaveProperty("github");
  });

  test("considère une valeur vide, ou laissée à <TO_PROVIDE>, comme manquante", () => {
    expect(failureOf({ ...VALID, HOST: "  " })).toContain("manquante(s) : HOST");
    expect(failureOf({ ...VALID, DATA_ENCRYPTION_KEY: "<TO_PROVIDE>" })).toContain(
      "manquante(s) : DATA_ENCRYPTION_KEY",
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

  test("refuse une clé de chiffrement des données trop courte, sans jamais l'afficher", () => {
    const message = failureOf({ ...VALID, DATA_ENCRYPTION_KEY: "courte-mais-secrete" });
    expect(message).toContain("invalide(s) : DATA_ENCRYPTION_KEY");
    expect(message).not.toContain("courte-mais-secrete");
  });

  test("refuse un délai de silence HTTP au-delà de 255 s, que Bun.serve refuserait", () => {
    expect(failureOf({ ...VALID, HTTP_IDLE_TIMEOUT_SECONDS: "256" })).toContain(
      "invalide(s) : HTTP_IDLE_TIMEOUT_SECONDS",
    );
  });

  test("n'admet http que vers la boucle locale : un cookie ou un jeton ne circule jamais en clair", () => {
    expect(failureOf({ ...VALID, APP_ORIGIN: "http://pipliner.example.org" })).toContain(
      "invalide(s) : APP_ORIGIN",
    );
    expect(failureOf({ ...VALID, APP_ORIGIN: "https://pipliner.example.org" })).toBe("");
  });

  test("APP_ORIGIN est une origine nue : un chemin est refusé", () => {
    expect(failureOf({ ...VALID, APP_ORIGIN: "http://127.0.0.1:8094/app" })).toContain(
      "invalide(s) : APP_ORIGIN",
    );
  });

  test("renvoie une configuration typée", () => {
    expect(parseEnv(VALID)).toEqual({
      host: "127.0.0.1",
      port: 8094,
      appOrigin: "http://127.0.0.1:8094",
      sessionSecret: "not-a-real-secret-only-for-tests-000000",
      dataEncryptionKey: "not-a-real-data-key-only-for-tests-00000",
      databasePath: "./data/pipliner.sqlite",
      httpIdleTimeoutSeconds: 240,
      sessions: { maxDays: 30, perUserMax: 5 },
      auditRetentionDays: 365,
      twoFactor: { everyHours: 24, maxAttempts: 5, lockMinutes: 15 },
    });
  });
});
