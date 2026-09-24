import { describe, expect, test } from "bun:test";
import type { RunConclusion, RunStatus, RunSummary } from "../../domain/githubTypes.ts";
import { isFinished, latestRunByWorkflow, runSignalOf } from "../../domain/runStatus.ts";

const run = (status: RunStatus, conclusion: RunConclusion | null = null) => ({ status, conclusion });

describe("signal d'une exécution", () => {
  test.each([
    ["success", "success", "Success"],
    ["failure", "failed", "Failed"],
    ["timed_out", "failed", "Timed out"],
    ["startup_failure", "failed", "Startup failure"],
    ["action_required", "attention", "Action required"],
    ["cancelled", "neutral", "Cancelled"],
    ["skipped", "neutral", "Skipped"],
    ["neutral", "neutral", "Neutral"],
    ["stale", "neutral", "Stale"],
  ] as const)("terminée avec « %s » → %s (%s)", (conclusion, signal, label) => {
    expect(runSignalOf(run("completed", conclusion))).toEqual({ signal, label });
  });

  test.each([
    ["queued", "queued", "Queued"],
    ["requested", "queued", "Requested"],
    ["pending", "queued", "Pending"],
    ["waiting", "attention", "Waiting for approval"],
    ["in_progress", "running", "In progress"],
  ] as const)("statut « %s » → %s (%s)", (status, signal, label) => {
    expect(runSignalOf(run(status))).toEqual({ signal, label });
  });

  test("aucune exécution, ou terminée sans conclusion", () => {
    expect(runSignalOf(null)).toEqual({ signal: "never", label: "No runs" });
    expect(runSignalOf(run("completed"))).toEqual({ signal: "neutral", label: "Completed" });
  });

  test("seule une exécution terminée est finie", () => {
    expect(isFinished(run("completed", "failure"))).toBe(true);
    expect(isFinished(run("in_progress"))).toBe(false);
    expect(isFinished(run("waiting"))).toBe(false);
  });
});

describe("dernière exécution par workflow", () => {
  const summary = (id: number, workflowId: number): RunSummary => ({
    id,
    workflowId,
    branch: "main",
    event: "push",
    status: "completed",
    conclusion: "success",
    htmlUrl: `https://github.com/o/r/actions/runs/${id}`,
    createdAt: "2026-09-24T10:00:00Z",
    startedAt: "2026-09-24T10:00:05Z",
    updatedAt: "2026-09-24T10:03:00Z",
  });

  test("garde la première rencontrée (GitHub trie de la plus récente à la plus ancienne)", () => {
    const latest = latestRunByWorkflow([summary(30, 1), summary(29, 2), summary(20, 1)]);
    expect(latest.get(1)?.id).toBe(30);
    expect(latest.get(2)?.id).toBe(29);
    expect(latest.size).toBe(2);
  });
});
