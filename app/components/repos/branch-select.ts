import { html, nothing, type PropertyValues } from "lit";
import { Component, Input, Reactive, TiniComponent } from "@tinijs/core";
import type { BranchesBody } from "../../../domain/apiContract.ts";
import type { BranchSummary } from "../../../domain/githubTypes.ts";
import type { RepoRef } from "../../../domain/selection.ts";
import { api, asLoadError, inTurn, type LoadState } from "../../services/api-client.ts";
import { sharedSheet } from "../../styles/shared-sheet.ts";
import { buttonClass } from "../../ui/button-classes.ts";
import { cn } from "../../ui/class-names.ts";
import { SELECT_CLASS } from "../../ui/field-classes.ts";

/**
 * Branche d'un dépôt, choisie dans sa ligne même (une par lancement, décision du 2026-09-24). Toutes
 * les branches sont proposées, qu'un pipeline y ait déjà tourné ou non, dans l'ordre préparé par le
 * serveur : branche par défaut épinglée, puis les actives (commit récent, comme la vue « Active » de
 * GitHub), puis les anciennes. Émet `branch-change` (détail : le nom de la branche).
 */
@Component({ name: "app-branch-select" })
export class AppBranchSelect extends TiniComponent {
  static override styles = [sharedSheet];

  @Input({ attribute: false }) repo: RepoRef | undefined = undefined;
  @Input() value = "";
  @Reactive() private state: LoadState<BranchesBody> = { status: "loading" };

  onChanges(changed: PropertyValues<this>): void {
    if (changed.has("repo") && this.repo) void this.load(false);
  }

  protected override render() {
    const state = this.state;
    return html`
      <div class="flex min-w-0 items-center gap-1">
        <label class="min-w-0 flex-1">
          <span class="sr-only">Branch of ${this.repo?.name ?? "the repository"}</span>
          <select
            class=${cn(SELECT_CLASS, "h-8 w-full min-w-0 px-2 font-mono text-xs")}
            ?disabled=${state.status !== "ready"}
            aria-busy=${state.status === "loading" ? "true" : "false"}
            title=${this.value}
            @change=${this.onChange}
          >
            ${state.status === "ready" ? this.renderBranchOptions(state.data) : this.renderCurrentOnly()}
          </select>
        </label>
        ${state.status === "error" ? this.renderRetry() : nothing}
      </div>
    `;
  }

  private renderCurrentOnly() {
    return html`<option value=${this.value} selected>${this.value}</option>`;
  }

  private renderBranchOptions({ defaultBranch, branches, truncated }: BranchesBody) {
    const others = branches.filter((branch) => branch.name !== defaultBranch);
    const listed = this.value === defaultBranch || others.some((branch) => branch.name === this.value);
    return html`
      ${listed ? nothing : this.renderCurrentOnly()}
      <option value=${defaultBranch} ?selected=${this.value === defaultBranch}>${defaultBranch} (default)</option>
      ${this.renderGroup("Active", others.filter((branch) => branch.active))}
      ${this.renderGroup("Stale", others.filter((branch) => !branch.active))}
      ${truncated ? html`<option disabled>Only the ${branches.length} most recent branches</option>` : nothing}
    `;
  }

  private renderGroup(label: string, branches: readonly BranchSummary[]) {
    if (branches.length === 0) return nothing;
    return html`<optgroup label=${label}>
      ${branches.map(
        (branch) => html`<option value=${branch.name} ?selected=${branch.name === this.value}>${branch.name}</option>`,
      )}
    </optgroup>`;
  }

  /** La liste n'a pas pu être lue : la branche courante reste choisie ; un bouton relance la lecture. */
  private renderRetry() {
    return html`<button
      type="button"
      class=${buttonClass({ variant: "ghost", size: "icon-xs" })}
      aria-label="Branches unavailable. Try again"
      title="Branches unavailable. Try again"
      @click=${() => void this.load(true)}
    >
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" class="size-3.5 text-signal-danger-text">
        <path d="M13 8a5 5 0 1 1-1.46-3.54M13 2.5V5h-2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path>
      </svg>
    </button>`;
  }

  /** ÉCHEC OUVERT : sans liste, la branche courante reste choisie et le reste de la ligne fonctionne. */
  private async load(fresh: boolean): Promise<void> {
    const repo = this.repo;
    if (!repo) return;
    this.state = { status: "loading" };
    try {
      const data = await inTurn(() => api.branches(repo, { fresh }));
      if (repo === this.repo) this.state = { status: "ready", data };
    } catch (err) {
      if (repo === this.repo) this.state = { status: "error", error: asLoadError(err) };
    }
  }

  private onChange(event: Event): void {
    this.emitEvent("branch-change", (event.target as HTMLSelectElement).value);
  }
}
