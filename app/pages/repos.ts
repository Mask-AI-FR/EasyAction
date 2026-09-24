import { html, nothing } from "lit";
import { Page, Reactive, TiniComponent } from "@tinijs/core";
import { getParams, go, ROUTE_CHANGE_EVENT } from "@tinijs/router";
import type { ReposBody } from "../../domain/apiContract.ts";
import {
  DEFAULT_REPO_QUERY,
  languagesOf,
  parseRepoQuery,
  queryRepos,
  repoQueryToParams,
  type RepoPage,
  type RepoQuery,
} from "../../domain/repoQuery.ts";
import { api, ApiError, asLoadError, type LoadState } from "../services/api-client.ts";
import { deselectRepos, resetSelection, selectionStore, selectRepos } from "../stores/selection-store.ts";
import { StoreController } from "../stores/store-controller.ts";
import { sharedSheet } from "../styles/shared-sheet.ts";
import { buttonClass } from "../ui/button-classes.ts";
import { errorPanel } from "../components/empty-state.ts";
import "../components/repos/bulk-action-bar.ts";
import "../components/repos/pagination-bar.ts";
import "../components/repos/repo-table.ts";
import "../components/repos/repo-toolbar.ts";

/**
 * Les dépôts d'une organisation, avec recherche, filtres, tri et pages ; chaque ligne s'ouvre sur ses
 * branches et ses workflows, et la sélection se lance depuis la barre d'action. La requête vit dans
 * l'adresse. Le routeur de TiniJS garde le même élément de page d'une organisation à l'autre : la page
 * se resynchronise donc sur l'événement `tini:route-change`, pas seulement à sa création.
 */
@Page({ name: "app-page-repos" })
export class AppPageRepos extends TiniComponent {
  static override styles = [sharedSheet];

  @Reactive() private org = "";
  @Reactive() private query: RepoQuery = DEFAULT_REPO_QUERY;
  @Reactive() private state: LoadState<ReposBody> = { status: "loading" };
  @Reactive() private avatarUrl: string | null = null;
  private readonly selection = new StoreController(this, selectionStore, "selection");

  private readonly onRouteChange = (): void => this.syncWithAddress();

  onCreate(): void {
    addEventListener(ROUTE_CHANGE_EVENT, this.onRouteChange);
    this.syncWithAddress();
  }

  onDestroy(): void {
    removeEventListener(ROUTE_CHANGE_EVENT, this.onRouteChange);
  }

  protected override render() {
    return html`
      <section class="space-y-5">
        <header class="flex flex-wrap items-center justify-between gap-4">
          <div class="flex min-w-0 items-center gap-3.5">
            ${this.avatarUrl
              ? html`<img src=${this.avatarUrl} alt="" width="44" height="44" class="size-11 shrink-0 rounded-lg border border-border bg-surface" />`
              : html`<span aria-hidden="true" class="size-11 shrink-0 rounded-lg bg-surface-secondary"></span>`}
            <div class="min-w-0">
              <p class="t-eyebrow">Organization</p>
              <h1 class="truncate text-xl font-semibold tracking-tight text-text-primary">${this.org}</h1>
              ${this.renderCounts()}
            </div>
          </div>
          <button
            type="button"
            class=${buttonClass({ variant: "outline", size: "sm" })}
            ?disabled=${this.state.status === "loading"}
            @click=${() => void this.load(true)}
          >
            Refresh
          </button>
        </header>
        ${this.renderState()}
        <app-bulk-action-bar class="sticky bottom-4 z-10 block" org=${this.org}></app-bulk-action-bar>
      </section>
    `;
  }

  private renderState() {
    const state = this.state;
    if (state.status === "loading") {
      return html`<div class="space-y-2" aria-busy="true">
        ${[0, 1, 2, 3, 4].map(() => html`<div class="skeleton-shimmer h-(--row-height) rounded-md"></div>`)}
      </div>`;
    }
    if (state.status === "error") return errorPanel(state.error, () => void this.load(true));
    return this.renderRepos(state.data);
  }

  /** « 30 repositories · 2 selected » sous le nom de l'organisation. */
  private renderCounts() {
    const state = this.state;
    if (state.status !== "ready") return nothing;
    const total = state.data.repos.length;
    const selected = this.selection.value.repoCount;
    return html`<p class="mt-0.5 text-xs text-text-secondary">
      ${total} ${total === 1 ? "repository" : "repositories"}${selected > 0
        ? html` · <span class="font-medium text-primary-text">${selected} selected</span>`
        : nothing}
    </p>`;
  }

  private renderRepos({ repos, truncated, totalCount }: ReposBody) {
    const page = queryRepos(repos, this.query);
    return html`
      <div class="rounded-lg border border-border bg-surface p-3 shadow-card">
        <app-repo-toolbar
          class="block"
          .query=${this.query}
          .languages=${languagesOf(repos)}
          .matching=${page.total}
          @query-change=${(event: CustomEvent<Partial<RepoQuery>>) => this.changeQuery(event.detail)}
        ></app-repo-toolbar>
      </div>
      ${truncated
        ? html`<p class="rounded-md bg-signal-warning-soft px-3 py-2 text-xs text-signal-warning-text">
            Showing the first ${repos.length} of ${totalCount} repositories (limit set by REPOS_MAX).
          </p>`
        : nothing}
      ${this.renderSelectAll(page)}
      ${page.total === 0 ? this.renderNoMatch(repos.length) : html`<app-repo-table .repos=${page.items}></app-repo-table>`}
      <app-pagination-bar
        .page=${page.page}
        .pageCount=${page.pageCount}
        @page-change=${(event: CustomEvent<number>) => this.changeQuery({ page: event.detail })}
      ></app-pagination-bar>
    `;
  }

  /** La case de l'en-tête ne coche que la page ; ce lien étend la sélection à tous les résultats. */
  private renderSelectAll(page: RepoPage) {
    const selection = this.selection.value;
    if (page.total <= page.items.length || selection.pageState(page.items) !== "all") return nothing;
    const link = buttonClass({ variant: "link", size: "xs" });
    return html`<p class="flex flex-wrap items-center gap-1 rounded-md bg-surface-secondary px-3 py-1.5 text-xs text-text-secondary">
      ${selection.pageState(page.matching) === "all"
        ? html`All ${page.total} matching repositories are selected.
            <button type="button" class=${link} @click=${() => deselectRepos(page.matching)}>Clear selection</button>`
        : html`All ${page.items.length} repositories on this page are selected.
            <button type="button" class=${link} @click=${() => selectRepos(page.matching)}>Select all ${page.total} matching</button>`}
    </p>`;
  }

  private renderNoMatch(repoCount: number) {
    const empty = repoCount === 0;
    return html`
      <section class="rounded-lg border border-border bg-surface shadow-card">
        <app-empty-state
          class="block"
          size="page"
          variant=${empty ? "empty" : "no-results"}
          heading=${empty ? "No repository" : "No repository matches these filters"}
          description=${empty
            ? "The GitHub App sees no repository here. Add repositories to its installation on GitHub."
            : "Change the search or the filters to see more repositories."}
        >
          ${empty
            ? nothing
            : html`<button slot="action" type="button" class=${buttonClass({ variant: "outline", size: "sm" })} @click=${() => this.changeQuery(DEFAULT_REPO_QUERY)}>
                Clear filters
              </button>`}
        </app-empty-state>
      </section>
    `;
  }

  /**
   * Relit l'organisation et la requête dans l'adresse ; ne recharge que si l'organisation change.
   * La requête vient de `location.search`, pas de `getQuery()` : le routeur de TiniJS 0.21 met ses
   * résultats en cache par chemin seul, et rendait donc la requête de la première visite.
   */
  private syncWithAddress(): void {
    const org: unknown = getParams().org;
    // Pendant un départ vers une autre page, l'événement arrive encore : on l'ignore.
    if (typeof org !== "string" || org === "") return;
    this.query = parseRepoQuery(Object.fromEntries(new URLSearchParams(location.search)));
    if (org !== this.org) {
      this.org = org;
      resetSelection();
      void this.load(false);
      void this.loadAvatar(org);
    }
  }

  private async load(fresh: boolean): Promise<void> {
    const org = this.org;
    this.state = { status: "loading" };
    try {
      const data = await api.repos(org, { fresh });
      if (org === this.org) this.state = { status: "ready", data };
    } catch (err) {
      if (org === this.org) this.state = { status: "error", error: asLoadError(err) };
    }
  }

  /**
   * ÉCHEC OUVERT : l'avatar n'est qu'une décoration ; sans lui, l'en-tête garde le nom de l'organisation.
   * La liste des organisations est déjà en mémoire (l'en-tête du tableau de bord l'a lue).
   */
  private async loadAvatar(org: string): Promise<void> {
    this.avatarUrl = null;
    try {
      const { orgs } = await api.orgs();
      const found = orgs.find((item) => item.login.toLowerCase() === org.toLowerCase());
      if (org === this.org) this.avatarUrl = found?.avatarUrl ?? null;
    } catch (err) {
      if (!(err instanceof ApiError || err instanceof TypeError)) throw err;
    }
  }

  private changeQuery(change: Partial<RepoQuery>): void {
    const params = new URLSearchParams(repoQueryToParams({ ...this.query, ...change })).toString();
    go(`/orgs/${encodeURIComponent(this.org)}${params ? `?${params}` : ""}`, true);
  }
}
