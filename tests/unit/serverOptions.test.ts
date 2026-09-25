import "../support/testEnv.ts";
import { describe, expect, test } from "bun:test";
import { listenOptions } from "../../server/app.ts";
import { parseEnv } from "../../server/config/env.ts";

describe("écoute du serveur", () => {
  test("Bun.serve reçoit l'adresse, le port et le délai de silence de la configuration", () => {
    const env = parseEnv({ ...process.env, HTTP_IDLE_TIMEOUT_SECONDS: "200" });
    expect(listenOptions(env)).toEqual({ hostname: "127.0.0.1", port: 8094, idleTimeout: 200 });
  });

  test("Bun accepte le délai maximal que la configuration admet (255 s)", () => {
    // Régression : sans réglage, Bun coupait une connexion silencieuse au bout de 10 s.
    const env = parseEnv({ ...process.env, HTTP_IDLE_TIMEOUT_SECONDS: "255" });
    const server = Bun.serve({ ...listenOptions(env), port: 0, fetch: () => new Response("ok") });
    expect(server.port).toBeGreaterThan(0);
    void server.stop(true);
  });
});
