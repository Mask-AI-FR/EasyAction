import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { Glob } from "bun";
import { errorFields, logger, type LogFields } from "../../server/config/logger.ts";

const ROOT = new URL("../../", import.meta.url).pathname;
const SCANNED = new Glob("{server,app,domain,scripts}/**/*.ts");

afterEach(() => {
  // Rend la main aux vrais flux après chaque espionnage.
  spyOn(process.stdout, "write").mockRestore();
  spyOn(process.stderr, "write").mockRestore();
});

describe("journal", () => {
  test("aucun console.* dans le code : tout passe par le journal à liste blanche", async () => {
    const offenders: string[] = [];
    for await (const path of SCANNED.scan({ cwd: ROOT })) {
      const source = await Bun.file(`${ROOT}${path}`).text();
      if (/\bconsole\.(log|info|warn|error|debug|trace)\b/.test(source)) offenders.push(path);
    }
    expect(offenders).toEqual([]);
  });

  test("n'écrit que les champs de la liste blanche, même si on lui passe un objet plus large", () => {
    const written: string[] = [];
    spyOn(process.stdout, "write").mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });
    const wider = { route: "/health", accessToken: "not-a-real-token" } as LogFields;
    logger.info("test.event", wider);
    const record = JSON.parse(written[0] ?? "{}") as Record<string, unknown>;
    expect(record.event).toBe("test.event");
    expect(record.route).toBe("/health");
    expect(record).not.toHaveProperty("accessToken");
  });

  test("errorFields ne garde que le nom et le code, jamais le message ni l'objet", () => {
    const err = Object.assign(new Error("contenu sensible"), {
      code: "E_TEST",
      config: { headers: { authorization: "not-a-real-token" } },
    });
    expect(errorFields(err)).toEqual({ errName: "Error", errCode: "E_TEST" });
    expect(errorFields("chaîne")).toEqual({ errName: "UnknownError" });
  });
});
