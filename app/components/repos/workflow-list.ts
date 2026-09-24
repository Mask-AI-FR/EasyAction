import { html, nothing } from "lit";
import { live } from "lit/directives/live.js";
import { repeat } from "lit/directives/repeat.js";
import { Component, Input, TiniComponent } from "@tinijs/core";
import type { ApiErrorCode, WorkflowsBody } from "../../../domain/apiContract.ts";
import type { WorkflowSummary } from "../../../domain/githubTypes.ts";
import { runSignalOf, type RunSignalView } from "../../../domain/runStatus.ts";
import type { RepoRef } from "../../../domain/selection.ts";
import type { ApiError, LoadState } from "../../services/api-client.ts";
import { latestTrackedRun, liveRunsStore, trackedRunView } from "../../services/run-poller.ts";
import { selectionStore } from "../../stores/selection-store.ts";
import { StoreController } from "../../stores/store-controller.ts";
import { sharedSheet } from "../../styles/shared-sheet.ts";
import { buttonClass } from "../../ui/button-classes.ts";
import { cn } from "../../ui/class-names.ts";
import { BADGE_CLASS, BADGE_TONE, CHECKBOX_CLASS } from "../../ui/field-classes.ts";
import "../status-badge.ts";

/** Échec de lecture des workflows d'UN dépôt : le message parle du dépôt, pas de l'organisation. */
const ERROR_TEXT: Partial<Record<ApiErrorCode, string>> = {
  forbidden: "GitHub refused access to this repository's workflows.",
  not_found: "Repository not found, or the GitHub App cannot see it.",
  rate_limited: "GitHub rate limit reached. Try again in a few minutes.",
  sso_required: "This organization requires single sign-on.",
};

type RunView = RunSignalView & { readonly url: string | null };

/**
 * Workflows GitHub Actions d'un dépôt sur la branche choisie : case (workflows actifs seulement),
 * nom, chemin du fichier (huit workflows MaskAI s'appellent « CI/CD »), état de la dernière
 * exécution. Une exécution lancée d'ici et suivie en direct remplace la dernière connue si elle est
 * plus récente. Émet `workflow-toggle` (détail : l'identifiant) et `retry`.
 */
@Component({ name: "app-workflow-list" })
export class AppWorkflowList extends TiniComponent {
  static override styles = [sharedSheet];

  @Input({ attribute: false }) repo: RepoRef | undefined = undefined;
  @Input() branch = "";
  @Input({ attribute: false }) state: LoadState<WorkflowsBody> = { status: "loading" };
  private readonly selection = new StoreController(this, selectionStore, "selection");
  private readonly liveRuns = new StoreController(this, liveRunsStore, "runs");

  protected override render() {
    const state = this.state;
    if (state.status === "loading") {
      return html`<div class="space-y-2" aria-busy="true" aria-label="Loading workflows">
        ${[0, 1].map(() => html`<div class="skeleton-shimmer h-11 rounded-md"></div>`)}
      </div>`;
    }
    if (state.status === "error") return this.renderError(state.error);
    const workflows = state.data.workflows;
    if (workflows.length === 0) {
      return html`<p class="text-xs text-text-tertiary">No GitHub Actions workflow in this repository.</p>`;
    }
    // Une branche sans exécution reste lançable : on le dit, pour qu'aucune case ne paraisse inerte.
    const neverRan = workflows.every((workflow) => this.runView(workflow).signal === "never");
    return html`
      ${neverRan
        ? html`<p class="mb-2 text-xs text-text-secondary">
            No pipeline has run on this branch yet. You can still select its workflows and run them.
          </p>`
        : nothing}
      <ul class="divide-y divide-border overflow-hidden rounded-md border border-border bg-surface">
        ${repeat(workflows, (workflow) => workflow.id, (workflow) => this.renderWorkflow(workflow))}
      </ul>
    `;
  }

  private renderWorkflow(workflow: WorkflowSummary) {
    const active = workflow.state === "active";
    const picked = active && this.repo !== undefined && this.selection.value.isWorkflowPicked(this.repo, workflow.id);
    const view = this.runView(workflow);
    return html`<li class="flex items-center gap-3 px-3 py-2">
      <input
        type="checkbox"
        class=${CHECKBOX_CLASS}
        aria-label=${`Select workflow ${workflow.name} (${workflow.path})`}
        ?disabled=${!active}
        .checked=${live(picked)}
        @change=${() => this.emitEvent("workflow-toggle", workflow.id)}
      />
      <div class="min-w-0 flex-1">
        <p class="truncate text-sm text-text-primary">${workflow.name}</p>
        <p class="truncate font-mono text-xs text-text-tertiary">${workflow.path}</p>
      </div>
      ${active ? nothing : html`<span class=${cn(BADGE_CLASS, BADGE_TONE.outline)}>Disabled</span>`}
      <app-status-badge signal=${view.signal} label=${view.label}></app-status-badge>
      <span class="w-16 shrink-0 text-right">
        ${view.url
          ? html`<a href=${view.url} target="_blank" rel="noopener noreferrer" class="text-xs font-medium text-primary-text hover:underline">View run</a>`
          : nothing}
      </span>
    </li>`;
  }

  /** L'exécution à montrer : la suivie en direct si elle est au moins aussi récente que la dernière connue. */
  private runView(workflow: WorkflowSummary): RunView {
    const latest = workflow.latestRun;
    const tracked = this.repo
      ? latestTrackedRun(this.liveRuns.value, {
          owner: this.repo.owner,
          repo: this.repo.name,
          workflowId: workflow.id,
          ref: this.branch,
        })
      : undefined;
    if (tracked && (!latest || tracked.runId >= latest.id)) {
      return { ...trackedRunView(tracked), url: tracked.run?.htmlUrl ?? tracked.htmlUrl };
    }
    return { ...runSignalOf(latest), url: latest?.htmlUrl ?? null };
  }

  private renderError(error: ApiError | null) {
    const text = error ? (ERROR_TEXT[error.code] ?? "GitHub did not answer.") : "EasyActions is unreachable.";
    return html`<div role="alert" class="flex flex-wrap items-center gap-2 text-xs text-signal-danger-text">
      <span>Workflows unavailable. ${text}</span>
      ${error?.details.ssoUrl
        ? html`<a href=${error.details.ssoUrl} target="_blank" rel="noopener noreferrer" class="font-medium underline">Authorize on GitHub</a>`
        : nothing}
      <button type="button" class=${buttonClass({ variant: "outline", size: "xs" })} @click=${() => this.emitEvent("retry")}>
        Try again
      </button>
    </div>`;
  }
}
