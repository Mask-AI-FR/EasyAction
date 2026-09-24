import { describe, expect, test } from "bun:test";
import type { DispatchOutcome, DispatchTarget } from "../../domain/dispatchContract.ts";
import { runDispatches } from "../../server/services/dispatchRunner.ts";

const target = (workflowId: number, ref = "main"): DispatchTarget => ({
  owner: "Mask-AI-FR",
  repo: "sandbox",
  workflowId,
  ref,
});

const dispatched = (sent: DispatchTarget): DispatchOutcome => ({
  status: "dispatched",
  target: sent,
  runId: sent.workflowId * 10,
  htmlUrl: null,
});

describe("lancement d'un lot", () => {
  test("une issue par cible distincte, dans l'ordre ; un doublon (casse comprise) ne part qu'une fois", async () => {
    const sent: DispatchTarget[] = [];
    const outcomes = await runDispatches(
      [target(1), target(2), { ...target(1), owner: "mask-ai-fr" }, target(1, "dev")],
      async (next) => {
        sent.push(next);
        return dispatched(next);
      },
      2,
    );
    expect(outcomes.map((outcome) => [outcome.target.workflowId, outcome.target.ref])).toEqual([
      [1, "main"],
      [2, "main"],
      [1, "dev"],
    ]);
    expect(sent).toHaveLength(3);
  });

  test("jamais plus de `concurrency` envois à la fois", async () => {
    let inFlight = 0;
    let peak = 0;
    await runDispatches(
      Array.from({ length: 9 }, (_, index) => target(index + 1)),
      async (next) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await Bun.sleep(5);
        inFlight -= 1;
        return dispatched(next);
      },
      3,
    );
    expect(peak).toBe(3);
  });

  test("limite de débit : plus rien ne part, la suite est « non tentée » (échec fermé)", async () => {
    const sent: number[] = [];
    const outcomes = await runDispatches(
      Array.from({ length: 5 }, (_, index) => target(index + 1)),
      async (next) => {
        sent.push(next.workflowId);
        if (next.workflowId === 2) return { status: "not_attempted", target: next, code: "rate_limited" };
        return dispatched(next);
      },
      1,
    );
    expect(sent).toEqual([1, 2]);
    expect(outcomes.map((outcome) => outcome.status)).toEqual([
      "dispatched",
      "not_attempted",
      "not_attempted",
      "not_attempted",
      "not_attempted",
    ]);
    expect(outcomes.slice(1)).toEqual(
      [2, 3, 4, 5].map((id) => ({ status: "not_attempted", target: target(id), code: "rate_limited" })),
    );
  });

  test("une issue inconnue (502, délai) n'est jamais relancée : exactement un envoi par cible", async () => {
    const calls = new Map<number, number>();
    const outcomes = await runDispatches(
      [target(1), target(2)],
      async (next) => {
        calls.set(next.workflowId, (calls.get(next.workflowId) ?? 0) + 1);
        return { status: "unknown", target: next, code: "upstream" };
      },
      2,
    );
    expect([...calls.values()]).toEqual([1, 1]);
    expect(outcomes.map((outcome) => outcome.status)).toEqual(["unknown", "unknown"]);
  });
});
