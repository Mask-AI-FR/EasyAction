import { describe, expect, test } from "bun:test";
import { keepTracking, MAX_CONSECUTIVE_FAILURES, nextPollSeconds } from "../../domain/pollingPolicy.ts";

describe("rythme du suivi en direct", () => {
  test("au minimum configuré pour quelques dépôts", () => {
    expect(nextPollSeconds(10, 1, 0)).toBe(10);
    expect(nextPollSeconds(10, 3, 0)).toBe(10);
  });

  test("plus lent quand plus de dépôts sont suivis (une requête GitHub par dépôt et par relevé)", () => {
    expect(nextPollSeconds(10, 4, 0)).toBe(20);
    expect(nextPollSeconds(10, 9, 0)).toBe(30);
  });

  test("double après chaque échec, sans jamais dépasser dix fois le minimum", () => {
    expect(nextPollSeconds(10, 1, 1)).toBe(20);
    expect(nextPollSeconds(10, 1, 2)).toBe(40);
    expect(nextPollSeconds(10, 30, 5)).toBe(100);
  });

  test("le suivi s'arrête : tout est fini, trop d'échecs, ou durée dépassée", () => {
    const base = { startedAt: 0, now: 60_000, maxMinutes: 30, unfinished: 2, consecutiveFailures: 0 };
    expect(keepTracking(base)).toBe(true);
    expect(keepTracking({ ...base, unfinished: 0 })).toBe(false);
    expect(keepTracking({ ...base, consecutiveFailures: MAX_CONSECUTIVE_FAILURES })).toBe(false);
    expect(keepTracking({ ...base, now: 30 * 60_000 })).toBe(false);
  });
});
