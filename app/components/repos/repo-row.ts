import { html, nothing } from "lit";
import { live } from "lit/directives/live.js";
import { Component, Input, Reactive, TiniComponent } from "@tinijs/core";
import type { WorkflowsBody } from "../../../domain/apiContract.ts";
import type { RepoSummary, RepoVisibility } from "../../../domain/githubTypes.ts";
import { api, asLoadError, type LoadState } from "../../services/api-client.ts";
import {
  branchFor,
  chooseBranch,
  selectionStore,
  toggleRepo,
  toggleWorkflow,
} from "../../stores/selection-store.ts";
import { StoreController } from "../../stores/store-controller.ts";
import { sharedSheet } from "../../styles/shared-sheet.ts";
import { buttonClass } from "../../ui/button-classes.ts";
import { cn } from "../../ui/class-names.ts";
import { BADGE_CLASS, BADGE_TONE, CHECKBOX_CLASS } from "../../ui/field-classes.ts";
import { TABLE_CELL_CLASS } from "../../ui/table-classes.ts";
import "./branch-select.ts";
import "./workflow-list.ts";

const VISIBILITY_LABEL: Record<RepoVisibility, string> = {
  public: "Public",
  private: "Private",
  internal: "Internal",
};

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const STEPS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["week", 604_800],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
];

/** « 3 days ago » ; l'heure exacte (UTC) reste disponible au survol. */
function relativeTime(iso: string | null): string {
  if (!iso) return "Never";
  const seconds = Math.round((Date.parse(iso) - Date.now()) / 1000);
  for (const [unit, size] of STEPS) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return "Just now";
}

function countLabel(workflows: WorkflowsBody["workflows"]): string {
  const active = workflows.filter((workflow) => workflow.state === "active").length;
  return `${workflows.length} ${workflows.length === 1 ? "workflow" : "workflows"} · ${active} active`;
}

/**
 * Une ligne de la liste des dépôts. Ses cellules sont les enfants directs de son shadow root : l'hôte
 * porte la grille (`TABLE_COLUMNS`, posée par le tableau) et elles s'y placent ; le détail déplié
 * occupe toute la largeur. La branche se choisit dans la ligne même (sa liste se charge avec la
 * ligne) ; les workflows ne sont lus qu'à l'ouverture (deux appels GitHub par dépôt ouvert, au lieu
 * de cinquante par page affichée).
 */
@Component({ name: "app-repo-row" })
export class AppRepoRow extends TiniComponent {
  static override styles = [sharedSheet];

  @Input({ attribute: false }) repo: RepoSummary | undefined = undefined;
  @Reactive() private expanded = false;
  /** Workflows de la branche choisie ; `null` tant que la ligne n'a jamais été ouverte. */
  @Reactive() private workflows: LoadState<WorkflowsBody> | null = null;
  private readonly selection = new StoreController(this, selectionStore, "selection");
  // Abonnement seul : la ligne se redessine quand la branche choisie change (lue par `branchFor`).
  private readonly branches = new StoreController(this, selectionStore, "branches");

  protected override render() {
    const repo = this.repo;
    if (!repo) return nothing;
    const branch = branchFor(repo);
    const state = this.selection.value.repoState(repo, this.activeIds());
    return html`
      <div role="cell" class=${cn(TABLE_CELL_CLASS, "flex items-center")}>
        <input
          type="checkbox"
          class=${CHECKBOX_CLASS}
          aria-label=${`Select ${repo.name}`}
          .checked=${live(state === "all")}
          .indeterminate=${live(state === "some")}
          @change=${() => toggleRepo(repo, state)}
        />
      </div>
      ${this.renderName(repo)}
      <div role="cell" class=${TABLE_CELL_CLASS}>
        <app-branch-select
          class="block"
          .repo=${repo}
          value=${branch}
          @branch-change=${(event: CustomEvent<string>) => this.onBranchChange(repo, event.detail)}
        ></app-branch-select>
      </div>
      <div
        role="cell"
        class=${cn(TABLE_CELL_CLASS, "text-xs text-text-secondary")}
        title=${repo.pushedAt ? new Date(repo.pushedAt).toUTCString() : ""}
      >
        ${relativeTime(repo.pushedAt)}
      </div>
      <div role="cell" class=${cn(TABLE_CELL_CLASS, "truncate text-xs text-text-tertiary")}>${repo.language ?? "—"}</div>
      <div role="cell" class=${cn(TABLE_CELL_CLASS, "flex justify-end")}>
        <button
          type="button"
          class=${buttonClass({ variant: "ghost", size: "icon-sm" })}
          aria-expanded=${this.expanded ? "true" : "false"}
          aria-controls="details"
          aria-label=${`Workflows of ${repo.name}`}
          @click=${this.onToggleExpanded}
        >
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" class=${cn("size-4 transition-transform duration-[var(--duration-fast)]", this.expanded && "rotate-180")}>
            <path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path>
          </svg>
        </button>
      </div>
      ${this.expanded ? this.renderDetails(repo, branch) : nothing}
    `;
  }

  private renderName(repo: RepoSummary) {
    return html`
      <div role="cell" class=${TABLE_CELL_CLASS}>
        <div class="flex min-w-0 items-center gap-2">
          <a
            href=${repo.htmlUrl}
            target="_blank"
            rel="noopener noreferrer"
            class="truncate text-sm font-medium text-text-primary hover:underline"
          >${repo.name}</a>
          <span class=${cn(BADGE_CLASS, BADGE_TONE.outline)}>${VISIBILITY_LABEL[repo.visibility]}</span>
          ${repo.archived ? html`<span class=${cn(BADGE_CLASS, BADGE_TONE.neutral)}>Archived</span>` : nothing}
        </div>
        ${repo.description
          ? html`<p class="mt-0.5 truncate text-xs text-text-secondary">${repo.description}</p>`
          : nothing}
      </div>
    `;
  }

  private renderDetails(repo: RepoSummary, branch: string) {
    const workflows = this.workflows;
    return html`
      <div
        id="details"
        role="cell"
        aria-colspan="6"
        class="col-span-full animate-fade-in border-t border-border bg-surface-secondary/40 px-(--row-padding-x) py-3"
      >
        <p class="mb-2.5 text-xs text-text-tertiary">
          Workflows on <span class="font-mono text-text-secondary">${branch}</span>${workflows?.status === "ready"
            ? ` · ${countLabel(workflows.data.workflows)}`
            : ""}
        </p>
        <app-workflow-list
          .repo=${repo}
          branch=${branch}
          .state=${workflows ?? { status: "loading" }}
          @workflow-toggle=${(event: CustomEvent<number>) => this.onWorkflowToggle(repo, event.detail)}
          @retry=${() => void this.loadWorkflows(true)}
        ></app-workflow-list>
      </div>
    `;
  }

  /** Workflows actifs du dépôt, s'ils sont chargés : l'état « partiel » de la case en dépend. */
  private activeIds(): readonly number[] | null {
    const workflows = this.workflows;
    if (workflows?.status !== "ready") return null;
    return workflows.data.workflows.filter((workflow) => workflow.state === "active").map((workflow) => workflow.id);
  }

  private onToggleExpanded(): void {
    this.expanded = !this.expanded;
    if (this.expanded && this.workflows === null) void this.loadWorkflows(false);
  }

  /** Les workflows ne sont relus que s'ils l'avaient déjà été (ligne ouverte au moins une fois). */
  private onBranchChange(repo: RepoSummary, branch: string): void {
    chooseBranch(repo, branch);
    if (this.workflows !== null) void this.loadWorkflows(false);
  }

  private onWorkflowToggle(repo: RepoSummary, workflowId: number): void {
    const activeIds = this.activeIds();
    if (activeIds) toggleWorkflow(repo, workflowId, activeIds);
  }

  /** ÉCHEC OUVERT : lecture seule ; l'échec reste dans la ligne, le reste de la page fonctionne. */
  private async loadWorkflows(fresh: boolean): Promise<void> {
    const repo = this.repo;
    if (!repo) return;
    const branch = branchFor(repo);
    const current = () => repo === this.repo && branch === branchFor(repo);
    this.workflows = { status: "loading" };
    try {
      const data = await api.workflows(repo, branch, { fresh });
      if (current()) this.workflows = { status: "ready", data };
    } catch (err) {
      if (current()) this.workflows = { status: "error", error: asLoadError(err) };
    }
  }
}
