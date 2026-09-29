import { html, nothing } from "lit";
import { Component, Input, Reactive, TiniComponent } from "@tinijs/core";
import type { DispatchOutcome } from "../../../domain/dispatchContract.ts";
import { planDispatch, summarizeOutcomes, type DispatchPlan } from "../../../domain/dispatchPlan.ts";
import type { WorkflowSummary } from "../../../domain/githubTypes.ts";
import type { RepoRef, RepoSelection } from "../../../domain/selection.ts";
import { api, ApiError } from "../../services/api-client.ts";
import { trackDispatched } from "../../services/run-poller.ts";
import { clearSelection, pipelineFor, selectionStore } from "../../stores/selection-store.ts";
import { sessionStore } from "../../stores/session-store.ts";
import { StoreController } from "../../stores/store-controller.ts";
import { showToast, updateToast, type ToastContent } from "../../stores/toast-store.ts";
import { sharedSheet } from "../../styles/shared-sheet.ts";
import { buttonClass } from "../../ui/button-classes.ts";
import { brandSpinner } from "../../ui/brand-mark.ts";
import "./dispatch-confirm.ts";

/** Lectures simultanées de workflows avant un lancement : borne la rafale d'appels à GitHub. */
const RESOLVE_CONCURRENCY = 4;

type Phase = "idle" | "resolving" | "dispatching";
type KnownWorkflows = Map<string, readonly WorkflowSummary[] | null>;

const pipelines = (count: number): string => `${count} ${count === 1 ? "pipeline" : "pipelines"}`;
const entryKey = (repo: RepoRef, branch: string): string => `${repo.owner}/${repo.name}@${branch}`;

/**
 * ÉCHEC FERMÉ par dépôt : des workflows illisibles valent `null`, et le plan ne lance rien dans ce
 * dépôt (la confirmation le nomme). Les autres dépôts restent lançables.
 */
async function readWorkflows(repo: RepoRef, branch: string): Promise<readonly WorkflowSummary[] | null> {
  try {
    return (await api.workflows(repo, branch)).workflows;
  } catch (err) {
    if (err instanceof ApiError || err instanceof TypeError) return null;
    throw err;
  }
}

/** Workflows de chaque dépôt coché, `RESOLVE_CONCURRENCY` lectures à la fois. */
async function resolveWorkflows(entries: readonly RepoSelection[]): Promise<KnownWorkflows> {
  const known: KnownWorkflows = new Map();
  let next = 0;
  const worker = async (): Promise<void> => {
    for (let entry = entries[next++]; entry; entry = entries[next++]) {
      known.set(entryKey(entry.repo, entry.branch), await readWorkflows(entry.repo, entry.branch));
    }
  };
  await Promise.all(Array.from({ length: Math.min(RESOLVE_CONCURRENCY, entries.length) }, worker));
  return known;
}

/** Résumé d'un lancement (« 4 dispatched · 1 rejected »), avec l'accès au détail. */
function resultToast(outcomes: readonly DispatchOutcome[], showDetails: () => void): ToastContent {
  const counts = summarizeOutcomes(outcomes);
  const action = { label: "View details", run: showDetails };
  if (counts.dispatched === outcomes.length) {
    return { tone: "success", title: `${pipelines(counts.dispatched)} dispatched`, description: "Live status is in the details.", action };
  }
  const parts: string[] = [];
  if (counts.dispatched) parts.push(`${counts.dispatched} dispatched`);
  if (counts.rejected) parts.push(`${counts.rejected} rejected`);
  if (counts.not_attempted) parts.push(`${counts.not_attempted} not sent`);
  if (counts.unknown) parts.push(`${counts.unknown} unconfirmed`);
  const description = counts.unknown
    ? "Check GitHub before running unconfirmed pipelines again."
    : "See the details for the reasons.";
  return { tone: "error", title: parts.join(" · "), description, action };
}

/**
 * L'appel lui-même a échoué. Refus du serveur (4xx) : rien n'est parti. Sans réponse (réseau, 5xx) :
 * une partie a pu partir, on le dit — et rien n'est renvoyé automatiquement.
 */
function failureToast(err: ApiError | TypeError): ToastContent {
  if (err instanceof ApiError && err.status < 500) {
    return { tone: "error", title: "Dispatch refused", description: "Nothing was started. Reload the page, then try again." };
  }
  return {
    tone: "error",
    title: "Dispatch result unknown",
    description: "EasyActions did not answer. Some pipelines may have started: check GitHub before running them again.",
  };
}

/**
 * Barre d'action de la sélection, collée au bas de la page. Elle porte tout le lancement : workflows
 * des dépôts cochés → plan (`domain/dispatchPlan.ts`) → confirmation → UN envoi au serveur → toasts →
 * suivi en direct. Rien n'est jamais renvoyé automatiquement : chaque workflow MaskAI déploie, un
 * doublon déploierait deux fois.
 */
@Component({ name: "app-bulk-action-bar" })
export class AppBulkActionBar extends TiniComponent {
  static override styles = [sharedSheet];

  @Input() org = "";
  @Reactive() private phase: Phase = "idle";
  @Reactive() private plan: DispatchPlan | null = null;
  @Reactive() private outcomes: readonly DispatchOutcome[] | null = null;
  @Reactive() private dialogOpen = false;
  private readonly selection = new StoreController(this, selectionStore, "selection");
  private readonly session = new StoreController(this, sessionStore, "session");

  protected override render() {
    return html`
      ${this.selection.value.repoCount > 0 ? this.renderBar() : nothing}
      <app-dispatch-confirm
        .open=${this.dialogOpen}
        .plan=${this.plan}
        .outcomes=${this.outcomes}
        .dispatching=${this.phase === "dispatching"}
        .maxTargets=${this.session.value?.limits.dispatchMaxTargets ?? 0}
        org=${this.org}
        @confirm=${() => void this.dispatch()}
        @dismiss=${() => (this.dialogOpen = false)}
      ></app-dispatch-confirm>
    `;
  }

  private renderBar() {
    const count = this.selection.value.repoCount;
    const busy = this.phase !== "idle";
    return html`
      <div
        role="region"
        aria-label="Selection"
        class="mx-auto flex w-fit items-center gap-4 rounded-lg border border-border bg-surface-elevated py-2 pr-2 pl-4 shadow-popover animate-fade-in"
      >
        <p class="text-sm text-text-primary">
          <span class="font-semibold tabular-nums">${count}</span> ${count === 1 ? "repository" : "repositories"} selected
        </p>
        <button type="button" class=${buttonClass({ variant: "ghost", size: "sm" })} ?disabled=${busy} @click=${() => clearSelection()}>
          Clear
        </button>
        <button
          type="button"
          class=${buttonClass({ size: "sm" })}
          ?disabled=${busy}
          aria-busy=${busy ? "true" : "false"}
          @click=${() => void this.prepare()}
        >
          ${this.phase === "resolving" ? brandSpinner(16) : nothing} Run pipelines
        </button>
      </div>
    `;
  }

  /** Lit les workflows des dépôts cochés, établit le plan et ouvre la confirmation. */
  private async prepare(): Promise<void> {
    const limits = this.session.value?.limits;
    if (!limits || this.phase !== "idle") return;
    const selection = this.selection.value;
    this.phase = "resolving";
    try {
      const known = await resolveWorkflows(selection.entries());
      const workflowsOf = (repo: RepoRef, branch: string) => known.get(entryKey(repo, branch)) ?? null;
      this.plan = planDispatch(selection, workflowsOf, pipelineFor, limits.dispatchMaxTargets);
      this.outcomes = null;
      this.dialogOpen = true;
    } finally {
      this.phase = "idle";
    }
  }

  /** Envoie le plan confirmé, une seule fois (un second clic pendant l'envoi est ignoré). */
  private async dispatch(): Promise<void> {
    const plan = this.plan;
    const limits = this.session.value?.limits;
    if (!plan || !limits || plan.items.length === 0 || plan.overLimit || this.phase !== "idle") return;
    this.phase = "dispatching";
    const toastId = showToast({ tone: "loading", title: `Dispatching ${pipelines(plan.items.length)}…` });
    try {
      const targets = plan.items.map(({ owner, repo, workflowId, ref }) => ({ owner, repo, workflowId, ref }));
      const { outcomes } = await api.dispatch(targets);
      this.outcomes = outcomes;
      clearSelection();
      trackDispatched(outcomes, limits);
      updateToast(toastId, resultToast(outcomes, () => (this.dialogOpen = true)));
    } catch (err) {
      if (!(err instanceof ApiError || err instanceof TypeError)) throw err;
      this.dialogOpen = false;
      updateToast(toastId, failureToast(err));
    } finally {
      this.phase = "idle";
    }
  }
}
