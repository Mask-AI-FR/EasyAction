import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { renderError } from "../../server/exceptions/errorHandler.ts";
import { originGuard } from "../../server/middleware/originGuard.ts";

const APP_ORIGIN = "http://127.0.0.1:8094";

function guarded(): Hono {
  const app = new Hono();
  app.use("*", originGuard(APP_ORIGIN));
  app.get("/lecture", (c) => c.text("ok"));
  app.post("/action", (c) => c.text("ok"));
  app.onError(renderError);
  return app;
}

describe("contrôle d'origine (anti-CSRF)", () => {
  test("une mutation venant de l'application passe", async () => {
    const response = await guarded().request("/action", {
      method: "POST",
      headers: { Origin: APP_ORIGIN },
    });
    expect(response.status).toBe(200);
  });

  test("une mutation venant d'un autre site est refusée", async () => {
    const response = await guarded().request("/action", {
      method: "POST",
      headers: { Origin: "https://evil.example" },
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      detail: { code: "forbidden_origin", message: "Cross-origin request refused" },
    });
  });

  test("une mutation sans en-tête Origin est refusée aussi (échec fermé)", async () => {
    const response = await guarded().request("/action", { method: "POST" });
    expect(response.status).toBe(403);
  });

  test("une lecture n'est pas concernée", async () => {
    const response = await guarded().request("/lecture");
    expect(response.status).toBe(200);
  });
});
