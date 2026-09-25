import "../support/testEnv.ts";
import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { FAKE_OWNER, FAKE_TOKENS, sessionStoreOf, signInDirectly } from "../support/sessions.ts";
import { testDatabase } from "../support/testDatabase.ts";
import { parseEnv } from "../../server/config/env.ts";
import { recordAuditEvent } from "../../server/repositories/auditEvents.ts";
import { toFreshTokens } from "../../server/services/githubTokens.ts";
import { endSessions, openSession, purgeExpiredData, resolveSession } from "../../server/services/sessions.ts";

const env = parseEnv(process.env);
const DAY_MS = 86_400_000;
const START = new Date("2026-09-25T08:00:00Z");

afterEach(() => setSystemTime());

function freshStore() {
  return sessionStoreOf(env, testDatabase());
}

const count = (store: ReturnType<typeof freshStore>, table: "sessions" | "audit_events") =>
  store.db.query<{ n: number }, []>(`SELECT count(*) AS n FROM ${table}`).get()?.n;

describe("sessions « rester connecté »", () => {
  test("une connexion ouvre une session de SESSION_MAX_DAYS jours, relue par son seul cookie", () => {
    setSystemTime(START);
    const store = freshStore();
    const opened = openSession(store, FAKE_OWNER, FAKE_TOKENS, undefined);
    expect(opened.maxAgeSeconds).toBe(30 * 86_400);
    const session = resolveSession(store, opened.cookieValue);
    expect(session).toMatchObject({ userId: 42, login: "octo-test", role: "member", tokenGeneration: 1 });
    expect(session?.expiresAt).toBe(START.getTime() / 1000 + 30 * 86_400);
  });

  test("la durée s'arrête avant si le jeton de rafraîchissement GitHub expire plus tôt", () => {
    setSystemTime(START);
    const store = freshStore();
    const opened = openSession(store, FAKE_OWNER, { ...FAKE_TOKENS, refreshExpiresIn: 10 * 86_400 }, undefined);
    expect(opened.maxAgeSeconds).toBe(10 * 86_400);
  });

  test("un cookie inconnu ne donne aucune session (échec fermé)", () => {
    const store = freshStore();
    signInDirectly(env, store.db);
    expect(resolveSession(store, "cookie-inventé")).toBeNull();
  });

  test("une session expirée est refusée, et effacée au passage", () => {
    setSystemTime(START);
    const store = freshStore();
    const cookie = signInDirectly(env, store.db);
    setSystemTime(new Date(START.getTime() + 31 * DAY_MS));
    expect(resolveSession(store, cookie)).toBeNull();
    expect(count(store, "sessions")).toBe(0);
  });

  test("au-delà de SESSIONS_PER_USER_MAX (5), les plus anciennes sont fermées et rendues pour révocation", () => {
    const store = freshStore();
    const cookies: string[] = [];
    let ended: readonly unknown[] = [];
    for (let index = 0; index < 6; index++) {
      setSystemTime(new Date(START.getTime() + index * 60_000));
      const opened = openSession(store, FAKE_OWNER, FAKE_TOKENS, undefined);
      cookies.push(opened.cookieValue);
      ended = opened.ended;
    }
    expect(ended).toHaveLength(1);
    expect(count(store, "sessions")).toBe(5);
    expect(resolveSession(store, cookies[0] ?? "")).toBeNull();
    expect(resolveSession(store, cookies[5] ?? "")).not.toBeNull();
  });

  test("« vu pour la dernière fois » n'est réécrit qu'une fois par minute au plus", () => {
    setSystemTime(START);
    const store = freshStore();
    const cookie = signInDirectly(env, store.db);
    const lastSeen = () => store.db.query<{ t: number }, []>("SELECT last_seen_at AS t FROM sessions").get()?.t;
    setSystemTime(new Date(START.getTime() + 30_000));
    resolveSession(store, cookie);
    expect(lastSeen()).toBe(START.getTime() / 1000);
    setSystemTime(new Date(START.getTime() + 61_000));
    resolveSession(store, cookie);
    expect(lastSeen()).toBe(START.getTime() / 1000 + 61);
  });

  test("fermer des sessions l'inscrit à l'historique et rend les sessions fermées", () => {
    const store = freshStore();
    const cookie = signInDirectly(env, store.db);
    const session = resolveSession(store, cookie);
    const ended = endSessions(store, { userId: 42 }, { action: "session.end_all", actorId: 42 });
    expect(ended.map((record) => record.idHash)).toEqual([session?.idHash ?? ""]);
    const actions = store.db.query<{ action: string }, []>("SELECT action FROM audit_events ORDER BY id").all();
    expect(actions.map((row) => row.action)).toEqual(["session.create", "session.end_all"]);
  });

  test("la purge efface les sessions expirées et l'historique plus vieux que AUDIT_RETENTION_DAYS", () => {
    setSystemTime(START);
    const store = freshStore();
    signInDirectly(env, store.db);
    recordAuditEvent(store.db, { action: "account.export", actorId: 42, targetId: null }, START.getTime() / 1000);
    setSystemTime(new Date(START.getTime() + 366 * DAY_MS));
    purgeExpiredData(store.db, env.auditRetentionDays);
    expect(count(store, "sessions")).toBe(0);
    expect(count(store, "audit_events")).toBe(0);
  });

  test("une réponse GitHub sans expiration ou sans jeton de rafraîchissement ne peut pas ouvrir de session", () => {
    const complete = { accessToken: "ghu_x", expiresIn: 28_800, refreshToken: "ghr_x", refreshExpiresIn: 100 };
    expect(toFreshTokens(complete)).not.toBeNull();
    expect(toFreshTokens({ ...complete, expiresIn: undefined })).toBeNull();
    expect(toFreshTokens({ ...complete, refreshToken: undefined })).toBeNull();
    expect(toFreshTokens({ ...complete, refreshExpiresIn: undefined })).toBeNull();
  });
});
