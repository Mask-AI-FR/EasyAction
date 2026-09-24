import { html } from "lit";
import { live } from "lit/directives/live.js";
import { repeat } from "lit/directives/repeat.js";
import { Component, Input, TiniComponent } from "@tinijs/core";
import type { RepoSummary } from "../../../domain/githubTypes.ts";
import { deselectRepos, selectionStore, selectRepos } from "../../stores/selection-store.ts";
import { StoreController } from "../../stores/store-controller.ts";
import { sharedSheet } from "../../styles/shared-sheet.ts";
import { cn } from "../../ui/class-names.ts";
import { CHECKBOX_CLASS } from "../../ui/field-classes.ts";
import {
  TABLE_CLASS,
  TABLE_COLUMNS,
  TABLE_HEAD_CELL_CLASS,
  TABLE_HEAD_CLASS,
  TABLE_ROW_CLASS,
} from "../../ui/table-classes.ts";
import "./repo-row.ts";

/**
 * Tableau des dépôts d'une page : en-tête de colonnes et une ligne (`app-repo-row`) par dépôt. La
 * case de l'en-tête coche ou décoche la page affichée ; partielle, elle coche toute la page.
 */
@Component({ name: "app-repo-table" })
export class AppRepoTable extends TiniComponent {
  static override styles = [sharedSheet];

  @Input({ attribute: false }) repos: readonly RepoSummary[] = [];
  private readonly selection = new StoreController(this, selectionStore, "selection");

  protected override render() {
    const pageState = this.selection.value.pageState(this.repos);
    return html`
      <div role="table" aria-label="Repositories" class=${TABLE_CLASS}>
        <div role="row" class=${cn(TABLE_COLUMNS, TABLE_HEAD_CLASS)}>
          <span role="columnheader" class=${cn(TABLE_HEAD_CELL_CLASS, "flex items-center")}>
            <input
              type="checkbox"
              class=${CHECKBOX_CLASS}
              aria-label="Select all repositories on this page"
              .checked=${live(pageState === "all")}
              .indeterminate=${live(pageState === "some")}
              @change=${() => (pageState === "all" ? deselectRepos(this.repos) : selectRepos(this.repos))}
            />
          </span>
          <span role="columnheader" class=${TABLE_HEAD_CELL_CLASS}>Repository</span>
          <span role="columnheader" class=${TABLE_HEAD_CELL_CLASS}>Branch</span>
          <span role="columnheader" class=${TABLE_HEAD_CELL_CLASS}>Last push</span>
          <span role="columnheader" class=${TABLE_HEAD_CELL_CLASS}>Language</span>
          <span role="columnheader" class=${TABLE_HEAD_CELL_CLASS}><span class="sr-only">Workflows</span></span>
        </div>
        ${repeat(
          this.repos,
          (repo) => repo.id,
          (repo) => html`<app-repo-row
            role="row"
            class=${cn(TABLE_COLUMNS, TABLE_ROW_CLASS)}
            .repo=${repo}
          ></app-repo-row>`,
        )}
      </div>
    `;
  }
}
