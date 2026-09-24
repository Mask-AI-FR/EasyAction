import { html } from "lit";
import { Component, Input, TiniComponent } from "@tinijs/core";
import {
  DEFAULT_REPO_QUERY,
  type RepoQuery,
  type RepoSort,
  type VisibilityFilter,
} from "../../../domain/repoQuery.ts";
import { sharedSheet } from "../../styles/shared-sheet.ts";
import { CHECKBOX_CLASS, INPUT_CLASS, SELECT_CLASS } from "../../ui/field-classes.ts";

/** Attente après la dernière frappe avant de filtrer : évite de réécrire l'adresse à chaque lettre. */
const SEARCH_DEBOUNCE_MS = 200;

const VISIBILITY_OPTIONS: readonly [VisibilityFilter, string][] = [
  ["all", "All visibilities"],
  ["public", "Public"],
  ["private", "Private"],
  ["internal", "Internal"],
];

const SORT_OPTIONS: readonly [RepoSort, string][] = [
  ["pushed", "Last push"],
  ["name", "Name"],
];

/**
 * Une seule rangée de filtres au-dessus de la liste. Chaque changement émet `query-change` (détail :
 * la partie de la requête modifiée, page remise à 1) ; la page le reporte dans l'adresse.
 */
@Component({ name: "app-repo-toolbar" })
export class AppRepoToolbar extends TiniComponent {
  static override styles = [sharedSheet];

  @Input({ attribute: false }) query: RepoQuery = DEFAULT_REPO_QUERY;
  @Input({ attribute: false }) languages: readonly string[] = [];
  @Input({ type: Number }) matching = 0;

  private searchTimer: ReturnType<typeof setTimeout> | undefined;

  onDestroy(): void {
    clearTimeout(this.searchTimer);
  }

  protected override render() {
    const query = this.query;
    return html`
      <div role="search" class="flex flex-wrap items-center gap-3">
        <label class="min-w-56 flex-1">
          <span class="sr-only">Search repositories</span>
          <input
            type="search"
            placeholder="Search repositories…"
            .value=${query.search}
            class=${INPUT_CLASS}
            @input=${this.onSearch}
          />
        </label>
        <label>
          <span class="sr-only">Visibility</span>
          <select class=${SELECT_CLASS} @change=${this.onVisibility}>
            ${VISIBILITY_OPTIONS.map(
              ([value, label]) =>
                html`<option value=${value} ?selected=${query.visibility === value}>${label}</option>`,
            )}
          </select>
        </label>
        <label>
          <span class="sr-only">Language</span>
          <select class=${SELECT_CLASS} @change=${this.onLanguage}>
            <option value="" ?selected=${query.language === ""}>All languages</option>
            ${this.languages.map(
              (language) =>
                html`<option value=${language} ?selected=${query.language === language}>${language}</option>`,
            )}
          </select>
        </label>
        <label>
          <span class="sr-only">Sort by</span>
          <select class=${SELECT_CLASS} @change=${this.onSort}>
            ${SORT_OPTIONS.map(
              ([value, label]) =>
                html`<option value=${value} ?selected=${query.sort === value}>Sort: ${label}</option>`,
            )}
          </select>
        </label>
        <label class="flex items-center gap-2 text-sm text-text-secondary">
          <input
            type="checkbox"
            class=${CHECKBOX_CLASS}
            .checked=${query.showArchived}
            @change=${this.onArchived}
          />
          Show archived
        </label>
        <span class="ml-auto text-xs text-text-tertiary" aria-live="polite">
          ${this.matching} matching
        </span>
      </div>
    `;
  }

  private emit(change: Partial<RepoQuery>): void {
    this.emitEvent("query-change", { ...change, page: 1 });
  }

  private onSearch(event: Event): void {
    const search = (event.target as HTMLInputElement).value;
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.emit({ search }), SEARCH_DEBOUNCE_MS);
  }

  private onVisibility(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    const visibility = VISIBILITY_OPTIONS.find(([known]) => known === value)?.[0] ?? "all";
    this.emit({ visibility });
  }

  private onLanguage(event: Event): void {
    this.emit({ language: (event.target as HTMLSelectElement).value });
  }

  private onSort(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.emit({ sort: SORT_OPTIONS.find(([known]) => known === value)?.[0] ?? "pushed" });
  }

  private onArchived(event: Event): void {
    this.emit({ showArchived: (event.target as HTMLInputElement).checked });
  }
}
