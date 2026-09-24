import "../support/testEnv.ts";
import { afterAll, describe, expect, test } from "bun:test";
import { CHROMIUM_BROWSERS, isEasyActionsUp, pickBrowser } from "../../scripts/desktop.ts";

const ours = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => Response.json({ status: "ok", service: "pipliner" }) });
const someoneElse = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => Response.json({ status: "ok" }) });

afterAll(() => {
  void ours.stop(true);
  void someoneElse.stop(true);
});

describe("commande bun run desktop", () => {
  test("choisit le premier navigateur Chromium installé, dans l'ordre de préférence", () => {
    const installed = new Map([
      ["chromium", "/usr/bin/chromium"],
      ["brave", "/usr/bin/brave"],
    ]);
    expect(pickBrowser((name) => installed.get(name) ?? null)).toBe("/usr/bin/brave");
    expect(CHROMIUM_BROWSERS[0]).toBe("brave");
  });

  test("sans navigateur Chromium, rien n'est choisi : la commande affiche seulement l'adresse", () => {
    expect(pickBrowser(() => null)).toBeNull();
  });

  test("reconnaît EasyActions à sa réponse /health, pas un autre service sur le même port", async () => {
    expect(await isEasyActionsUp(`http://127.0.0.1:${ours.port}`)).toBe(true);
    expect(await isEasyActionsUp(`http://127.0.0.1:${someoneElse.port}`)).toBe(false);
  });

  test("personne n'écoute : « pas démarré » (Bun lève une Error à code, pas un TypeError)", async () => {
    expect(await isEasyActionsUp("http://127.0.0.1:1")).toBe(false);
  });
});
