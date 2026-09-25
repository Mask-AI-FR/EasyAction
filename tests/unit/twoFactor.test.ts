import "../support/testEnv.ts";
import { afterEach, beforeEach, describe, expect, setSystemTime, spyOn, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { codeFor, enrollDirectly, FAKE_TOTP_SECRET, signInDirectly, twoFactorStoreOf } from "../support/sessions.ts";
import { testDatabase } from "../support/testDatabase.ts";
import type { EnrollmentBody, RecoveryCodesBody, TwoFactorStatusBody } from "../../domain/twoFactorContract.ts";
import { buildApp } from "../../server/app.ts";
import { parseEnv } from "../../server/config/env.ts";
import { resetSecondFactor } from "../../server/services/twoFactor.ts";

const env = parseEnv(process.env);
const START = new Date("2026-09-25T08:00:10Z");
let db: Database;
let app: ReturnType<typeof buildApp>;

beforeEach(() => {
  setSystemTime(START);
  db = testDatabase();
  app = buildApp(env, db);
  spyOn(process.stdout, "write").mockImplementation(() => true);
  spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  setSystemTime();
  spyOn(process.stdout, "write").mockRestore();
  spyOn(process.stderr, "write").mockRestore();
});

const later = (ms: number) => setSystemTime(new Date(Date.now() + ms));

async function call(cookie: string, path: string, json?: unknown) {
  const headers: Record<string, string> = { Cookie: `pipliner_session=${cookie}`, Origin: env.appOrigin };
  if (json !== undefined) headers["Content-Type"] = "application/json";
  return app.request(path, { method: json === undefined ? "GET" : "POST", headers, body: json === undefined ? undefined : JSON.stringify(json) });
}

const newCookie = (response: Response) =>
  response.headers.getSetCookie().find((header) => header.startsWith("pipliner_session="))?.split(";")[0]?.slice(17) ?? "";
const stateOf = async (cookie: string) => ((await (await call(cookie, "/api/session")).json()) as { secondFactor: string }).secondFactor;
const actions = () => db.query<{ action: string }, []>("SELECT action FROM audit_events ORDER BY id").all().map((row) => row.action);

/** Mise en place complète par les routes : rend le secret, les codes de secours et le cookie renouvelé. */
async function setUp(cookie: string) {
  const started = (await (await call(cookie, "/api/account/two-factor/enrollment", {})).json()) as EnrollmentBody;
  const secret = started.manualKey.replace(/\s/g, "");
  const confirmed = await call(cookie, "/api/account/two-factor/enrollment/confirm", { code: codeFor(secret) });
  const { recoveryCodes } = (await confirmed.json()) as RecoveryCodesBody;
  return { started, secret, recoveryCodes, cookie: newCookie(confirmed), status: confirmed.status };
}

describe("mise en place de l'application d'authentification", () => {
  test("clé et QR code, premier code → 10 codes de secours et un NOUVEAU cookie (l'ancien ne vaut plus rien)", async () => {
    const first = signInDirectly(env, db, { verified: false });
    expect(await stateOf(first)).toBe("setup");
    const start = await call(first, "/api/account/two-factor/enrollment", {});
    const started = (await start.clone().json()) as EnrollmentBody;
    expect(started).toMatchObject({ issuer: "EasyActions", account: "octo-test" });
    expect(started.manualKey).toMatch(/^[A-Z2-7]{4}( [A-Z2-7]{4}){7}$/);
    const qr = await call(first, "/api/account/two-factor/enrollment/qr.svg");
    expect(qr.headers.get("content-type")).toBe("image/svg+xml");
    expect(qr.headers.get("cache-control")).toBe("no-store");
    expect(await qr.text()).toStartWith("<svg");
    const secret = started.manualKey.replace(/\s/g, "");
    const confirmed = await call(first, "/api/account/two-factor/enrollment/confirm", { code: codeFor(secret) });
    expect(confirmed.status).toBe(200);
    expect(((await confirmed.json()) as RecoveryCodesBody).recoveryCodes).toHaveLength(10);
    const renewed = newCookie(confirmed);
    expect(renewed).not.toBe("");
    expect((await call(first, "/api/session")).status).toBe(401);
    expect(await stateOf(renewed)).toBe("verified");
    expect(JSON.stringify(db.query("SELECT * FROM second_factors").all())).not.toContain(secret);
    expect(actions()).toContain("two_factor.enroll");
  });

  test("un code faux à la mise en place : 400 invalid_code, et il compte", async () => {
    const cookie = signInDirectly(env, db, { verified: false });
    await call(cookie, "/api/account/two-factor/enrollment", {});
    const response = await call(cookie, "/api/account/two-factor/enrollment/confirm", { code: "000000" });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { detail: { code: string } }).detail.code).toBe("invalid_code");
    expect(actions()).toContain("two_factor.fail");
  });

  test("pas de QR code sans mise en place en cours", async () => {
    const cookie = signInDirectly(env, db, { verified: false });
    expect((await call(cookie, "/api/account/two-factor/enrollment/qr.svg")).status).toBe(404);
  });
});

describe("le code du jour", () => {
  test("au-delà de TWO_FACTOR_EVERY_HOURS, la session doit redonner un code ; un code accepté ne resert pas", async () => {
    const cookie = signInDirectly(env, db);
    expect((await call(cookie, "/api/account/sessions")).status).toBe(200);
    later(25 * 3_600_000);
    expect(await stateOf(cookie)).toBe("verify");
    const blocked = await call(cookie, "/api/account/sessions");
    expect(blocked.status).toBe(403);
    expect(((await blocked.json()) as { detail: { code: string } }).detail.code).toBe("second_factor_required");
    const code = codeFor();
    const verified = await call(cookie, "/api/account/two-factor/verify", { code });
    expect(verified.status).toBe(204);
    const renewed = newCookie(verified);
    expect((await call(renewed, "/api/account/sessions")).status).toBe(200);
    expect((await call(renewed, "/api/account/two-factor/verify", { code })).status).toBe(400);
  });

  test("trop de codes faux : bloqué TWO_FACTOR_LOCK_MINUTES, même avec le bon code, puis deux fois plus longtemps", async () => {
    const cookie = signInDirectly(env, db, { verified: false });
    enrollDirectly(env, db);
    for (let attempt = 1; attempt < 5; attempt++) {
      expect((await call(cookie, "/api/account/two-factor/verify", { code: "000000" })).status).toBe(400);
    }
    const locked = await call(cookie, "/api/account/two-factor/verify", { code: "000000" });
    expect(locked.status).toBe(429);
    expect(locked.headers.get("retry-after")).toBe("900");
    expect(((await locked.json()) as { detail: { retryAfterSeconds: number } }).detail.retryAfterSeconds).toBe(900);
    expect((await call(cookie, "/api/account/two-factor/verify", { code: codeFor() })).status).toBe(429);
    later(16 * 60_000);
    for (let attempt = 1; attempt < 5; attempt++) await call(cookie, "/api/account/two-factor/verify", { code: "000000" });
    const again = await call(cookie, "/api/account/two-factor/verify", { code: "000000" });
    expect(again.headers.get("retry-after")).toBe("1800");
    expect(actions().filter((action) => action === "two_factor.lock")).toHaveLength(2);
  });

  test("un code de secours remplace le code du jour, une seule fois (saisie tolérante)", async () => {
    const { recoveryCodes, cookie } = await setUp(signInDirectly(env, db, { verified: false }));
    later(25 * 3_600_000);
    const [first = "", second = ""] = recoveryCodes;
    const used = await call(cookie, "/api/account/two-factor/verify", { recoveryCode: first });
    expect(used.status).toBe(204);
    const renewed = newCookie(used);
    later(25 * 3_600_000);
    expect((await call(renewed, "/api/account/two-factor/verify", { recoveryCode: first })).status).toBe(400);
    const relaxed = second.toLowerCase().replace("-", " ");
    expect((await call(renewed, "/api/account/two-factor/verify", { recoveryCode: relaxed })).status).toBe(204);
    expect(actions().filter((action) => action === "two_factor.recovery_used")).toHaveLength(2);
  });
});

describe("changer d'application, codes de secours, retrait", () => {
  test("changer d'application exige une session vérifiée ET un code actuel ; l'ancienne ne vaut plus ensuite", async () => {
    const pending = signInDirectly(env, db, { verified: false });
    enrollDirectly(env, db);
    expect((await call(pending, "/api/account/two-factor/enrollment", {})).status).toBe(403);
    const cookie = signInDirectly(env, db);
    expect((await call(cookie, "/api/account/two-factor/enrollment", {})).status).toBe(403);
    expect((await call(cookie, "/api/account/two-factor/enrollment", { code: "000000" })).status).toBe(400);
    later(30_000);
    const started = await call(cookie, "/api/account/two-factor/enrollment", { code: codeFor() });
    const secret = ((await started.json()) as EnrollmentBody).manualKey.replace(/\s/g, "");
    expect(secret).not.toBe(FAKE_TOTP_SECRET);
    const confirmed = await call(cookie, "/api/account/two-factor/enrollment/confirm", { code: codeFor(secret) });
    expect(confirmed.status).toBe(200);
    later(60_000);
    const renewed = newCookie(confirmed);
    expect((await call(renewed, "/api/account/two-factor/recovery-codes", { code: codeFor() })).status).toBe(400);
    expect((await call(renewed, "/api/account/two-factor/recovery-codes", { code: codeFor(secret) })).status).toBe(200);
  });

  test("nouveaux codes de secours : un code actuel exigé ; les anciens ne valent plus rien", async () => {
    const { recoveryCodes, cookie, secret } = await setUp(signInDirectly(env, db, { verified: false }));
    later(30_000);
    const fresh = await call(cookie, "/api/account/two-factor/recovery-codes", { code: codeFor(secret) });
    expect(((await fresh.json()) as RecoveryCodesBody).recoveryCodes).toHaveLength(10);
    const status = (await (await call(cookie, "/api/account/two-factor")).json()) as TwoFactorStatusBody;
    expect(status).toMatchObject({ enabled: true, recoveryCodesLeft: 10 });
    later(25 * 3_600_000);
    expect((await call(cookie, "/api/account/two-factor/verify", { recoveryCode: recoveryCodes[0] })).status).toBe(400);
  });

  test("retrait (administrateur ou ligne de commande) : toutes les sessions refont la mise en place", async () => {
    const cookie = signInDirectly(env, db);
    resetSecondFactor(twoFactorStoreOf(env, db), 42, null);
    expect(await stateOf(cookie)).toBe("setup");
    expect((await call(cookie, "/api/account/sessions")).status).toBe(403);
    expect(db.query("SELECT count(*) AS n FROM recovery_codes").get()).toEqual({ n: 0 });
    expect(actions().at(-1)).toBe("two_factor.reset");
  });
});
