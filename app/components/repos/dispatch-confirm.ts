import { html, nothing, type PropertyValues } from "lit";
import { live } from "lit/directives/live.js";
import { Component, Input, Reactive, TiniComponent } from "@tinijs/core";
import type { DispatchOutcome, DispatchRejection } from "../../../domain/dispatchContract.ts";
import {
  summarizeOutcomes,
  type DispatchPlan,
  type DispatchPlanItem,
  type OutcomeCounts,
} from "../../../domain/dispatchPlan.ts";
import type { RunSignalView } from "../../../domain/runStatus.ts";
import { liveRunsStore, trackedRunView, type TrackedRun } from "../../services/run-poller.ts";
import { StoreController } from "../../stores/store-controller.ts";
import { sharedSheet } from "../../styles/shared-sheet.ts";
import { buttonClass } from "../../ui/button-classes.ts";
import { cn } from "../../ui/class-names.ts";
import { BADGE_CLASS, INPUT_CLASS } from "../../ui/field-classes.ts";
import { brandSpinner } from "../../ui/brand-mark.ts";
import "../confirm-dialog.ts";
import "../status-badge.ts";

const REJECTION_LABEL: Record<DispatchRejection, string> = {
  no_dispatch_trigger: "No workflow_dispatch trigger",
  missing_inputs: "Needs inputs",
  ref_not_found: "Branch not found",
  not_found: "Workflow not found",
  forbidden: "Refused by GitHub",
  sso_required: "Single sign-on required",
  unprocessable: "Refused by GitHub",
};

const CALLOUT_CLASS = {
  danger: "bg-signal-danger-soft text-signal-danger-text",
  warning: "bg-signal-warning-soft text-signal-warning-text",
  neutral: "bg-surface-secondary text-text-secondary",
} as const;

const LIST_CLASS = "max-h-72 divide-y divide-border overflow-y-auto rounded-md border border-border";

const pipelines = (count: number): string => `${count} ${count === 1 ? "pipeline" : "pipelines"}`;
const targetKey = (target: { owner: string; repo: string; workflowId: number; ref: string }): string =>
  `${target.owner}/${target.repo}#${target.workflowId}@${target.ref}`;

function callout(tone: keyof typeof CALLOUT_CLASS, text: string) {
  return html`<p class=${cn("rounded-md px-3 py-2 text-xs", CALLOUT_CLASS[tone])}>${text}</p>`;
}

/** « a, b, c and 4 more » : une liste de dépôts qui reste lisible dans un avertissement. */
function namesOf(repos: readonly string[]): string {
  const shown = repos.slice(0, 3).join(", ");
  return repos.length > 3 ? `${shown} and ${repos.length - 3} more` : shown;
}

function summaryOf(counts: OutcomeCounts): string {
  const parts: [number, string][] = [
    [counts.dispatched, "dispatched"],
    [counts.rejected, "rejected by GitHub"],
    [counts.not_attempted, "not sent"],
    [counts.unknown, "unconfirmed"],
  ];
  return parts.filter(([count]) => count > 0).map(([count, label]) => `${count} ${label}`).join(" · ");
}

/** Signal d'une cible après l'envoi ; une exécution suivie montre son état en direct. */
function outcomeView(outcome: DispatchOutcome, runs: ReadonlyMap<number, TrackedRun>): RunSignalView {
  switch (outcome.status) {
    case "dispatched": {
      const tracked = outcome.runId === null ? undefined : runs.get(outcome.runId);
      if (tracked) return trackedRunView(tracked);
      return { signal: "queued", label: outcome.runId === null ? "Dispatched, not tracked" : "Dispatched" };
    }
    case "rejected":
      return { signal: "failed", label: REJECTION_LABEL[outcome.code] };
    case "not_attempted":
      return { signal: "neutral", label: outcome.code === "rate_limited" ? "Not sent: rate limit" : "Not sent: signed out" };
    case "unknown":
      return { signal: "attention", label: "Unconfirmed: check GitHub" };
  }
}

/**
 * Confirmation d'un lancement, puis son résultat. Tout ce qui partira est listé (dépôt, workflow,
 * chemin, branche) avec les risques : branche par défaut (production pour MaskAI), plusieurs
 * workflows d'un dépôt (groupes de concurrence), dépôts illisibles, plafond. Sur une branche par
 * défaut, le bouton reste inactif tant que le nom de l'organisation n'est pas saisi.
 * Émet `confirm` et `dismiss`.
 */
@Component({ name: "app-dispatch-confirm" })
export class AppDispatchConfirm extends TiniComponent {
  static override styles = [sharedSheet];

  @Input({ attribute: false }) open = false;
  @Input({ attribute: false }) plan: DispatchPlan | null = null;
  @Input({ attribute: false }) outcomes: readonly DispatchOutcome[] | null = null;
  @Input({ attribute: false }) dispatching = false;
  @Input({ attribute: false }) maxTargets = 0;
  @Input() org = "";
  @Reactive() private typed = "";
  private readonly liveRuns = new StoreController(this, liveRunsStore, "runs");

  onChanges(changed: PropertyValues<this>): void {
    if (changed.has("plan")) this.typed = "";
  }

  protected override render() {
    const plan = this.plan;
    if (!plan) return nothing;
    const outcomes = this.outcomes;
    return html`
      <app-confirm-dialog
        .open=${this.open}
        heading=${outcomes ? "Dispatch results" : `Run ${pipelines(plan.items.length)}?`}
        @dismiss=${this.dismiss}
      >
        ${outcomes ? this.renderResults(plan, outcomes) : this.renderConfirm(plan)}
      </app-confirm-dialog>
    `;
  }

  private renderConfirm(plan: DispatchPlan) {
    const needsTyping = plan.defaultBranchCount > 0;
    const ready = plan.items.length > 0 && !plan.overLimit && (!needsTyping || this.typed === this.org);
    return html`
      <div class="space-y-3">
        <p class="text-sm text-text-secondary">
          These GitHub Actions workflows start as soon as you confirm. EasyActions never retries a dispatch.
        </p>
        ${this.renderWarnings(plan)}
        ${plan.items.length > 0 ? this.renderPlanItems(plan.items) : nothing}
        ${needsTyping ? this.renderTyping() : nothing}
      </div>
      <div slot="footer" class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" class=${buttonClass({ variant: "outline" })} @click=${this.dismiss}>Cancel</button>
        <button
          type="button"
          class=${buttonClass({ variant: needsTyping ? "destructive" : "default" })}
          ?disabled=${!ready || this.dispatching}
          aria-busy=${this.dispatching ? "true" : "false"}
          @click=${() => this.emitEvent("confirm")}
        >
          ${this.dispatching ? brandSpinner(16) : nothing} Run ${pipelines(plan.items.length)}
        </button>
      </div>
    `;
  }

  private renderWarnings(plan: DispatchPlan) {
    return html`
      ${plan.overLimit
        ? callout("danger", `One run is limited to ${pipelines(this.maxTargets)}. Deselect some repositories or workflows.`)
        : nothing}
      ${plan.defaultBranchCount > 0
        ? callout("danger", `${pipelines(plan.defaultBranchCount)} ${plan.defaultBranchCount === 1 ? "runs" : "run"} on a default branch. For MaskAI repositories this deploys to production.`)
        : nothing}
      ${plan.reposWithSeveral.length > 0
        ? callout("warning", `Several workflows start in ${namesOf(plan.reposWithSeveral)}. Workflows sharing a concurrency group can cancel each other's pending runs.`)
        : nothing}
      ${plan.unreadableRepos.length > 0
        ? callout("warning", `Workflows could not be read for ${namesOf(plan.unreadableRepos)}. Nothing starts there.`)
        : nothing}
      ${plan.emptyRepos.length > 0
        ? callout("neutral", `No active workflow to run in ${namesOf(plan.emptyRepos)}.`)
        : nothing}
    `;
  }

  private renderPlanItems(items: readonly DispatchPlanItem[]) {
    return html`<ul class=${LIST_CLASS} aria-label="Pipelines to run">
      ${items.map(
        (item) => html`<li class="flex items-center gap-3 px-3 py-2">
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm text-text-primary"><span class="font-medium">${item.repo}</span> · ${item.workflowName}</p>
            <p class="truncate font-mono text-xs text-text-tertiary">${item.workflowPath}</p>
          </div>
          <span class="max-w-40 truncate font-mono text-xs text-text-secondary">${item.ref}</span>
          ${item.isDefaultBranch
            ? html`<span class=${cn(BADGE_CLASS, CALLOUT_CLASS.danger)}>Default branch</span>`
            : nothing}
        </li>`,
      )}
    </ul>`;
  }

  private renderTyping() {
    return html`<label class="block space-y-1.5">
      <span class="text-xs text-text-secondary">
        Type <span class="font-mono font-semibold text-text-primary">${this.org}</span> to confirm
      </span>
      <input
        class=${INPUT_CLASS}
        autocomplete="off"
        spellcheck="false"
        .value=${live(this.typed)}
        @input=${(event: Event) => (this.typed = (event.target as HTMLInputElement).value)}
      />
    </label>`;
  }

  private renderResults(plan: DispatchPlan, outcomes: readonly DispatchOutcome[]) {
    const counts = summarizeOutcomes(outcomes);
    const items = new Map(plan.items.map((item) => [targetKey(item), item]));
    return html`
      <div class="space-y-3">
        <p class="text-sm text-text-secondary">${summaryOf(counts)}. Statuses refresh while the runs are in progress.</p>
        ${counts.unknown > 0
          ? callout("warning", "GitHub did not confirm some dispatches. Check the Actions page before running them again: a second run would deploy again.")
          : nothing}
        <ul class=${LIST_CLASS} aria-label="Dispatch results">
          ${outcomes.map((outcome) => this.renderOutcome(outcome, items.get(targetKey(outcome.target))))}
        </ul>
      </div>
      <div slot="footer" class="flex justify-end">
        <button type="button" class=${buttonClass({ variant: "outline" })} @click=${this.dismiss}>Close</button>
      </div>
    `;
  }

  private renderOutcome(outcome: DispatchOutcome, item: DispatchPlanItem | undefined) {
    const view = outcomeView(outcome, this.liveRuns.value);
    const tracked = outcome.status === "dispatched" && outcome.runId !== null ? this.liveRuns.value.get(outcome.runId) : undefined;
    const url = tracked?.run?.htmlUrl ?? (outcome.status === "dispatched" ? outcome.htmlUrl : null);
    return html`<li class="flex items-center gap-3 px-3 py-2">
      <div class="min-w-0 flex-1">
        <p class="truncate text-sm text-text-primary">
          <span class="font-medium">${outcome.target.repo}</span> · ${item?.workflowName ?? `Workflow ${outcome.target.workflowId}`}
        </p>
        <p class="truncate font-mono text-xs text-text-tertiary">
          ${item ? `${item.workflowPath} · ${outcome.target.ref}` : outcome.target.ref}
        </p>
      </div>
      <app-status-badge signal=${view.signal} label=${view.label}></app-status-badge>
      <span class="w-16 shrink-0 text-right">
        ${url
          ? html`<a href=${url} target="_blank" rel="noopener noreferrer" class="text-xs font-medium text-primary-text hover:underline">View run</a>`
          : nothing}
      </span>
    </li>`;
  }

  private dismiss(): void {
    this.emitEvent("dismiss");
  }
}
