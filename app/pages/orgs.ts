import { html, nothing } from "lit";
import { Page, Reactive, TiniComponent } from "@tinijs/core";
import type { OrgsBody } from "../../domain/apiContract.ts";
import type { OrgSummary } from "../../domain/githubTypes.ts";
import { api, asLoadError, type LoadState } from "../services/api-client.ts";
import { sharedSheet } from "../styles/shared-sheet.ts";
import { buttonClass } from "../ui/button-classes.ts";
import { errorPanel } from "../components/empty-state.ts";

/** Avatar GitHub à la taille affichée (paramètre `s`), sans perdre ses autres paramètres. */
function sizedAvatar(url: string, size: number): string {
  const sized = new URL(url);
  sized.searchParams.set("s", String(size));
  return sized.toString();
}

/** Étape 1 : choisir l'organisation, parmi celles où l'app GitHub est installée. */
@Page({ name: "app-page-orgs" })
export class AppPageOrgs extends TiniComponent {
  static override styles = [sharedSheet];

  @Reactive() private state: LoadState<OrgsBody> = { status: "loading" };

  onCreate(): void {
    void this.load(false);
  }

  protected override render() {
    return html`
      <section class="space-y-6">
        <header>
          <p class="t-eyebrow">Step 1</p>
          <h1 class="mt-1 text-xl font-semibold tracking-tight text-text-primary">
            Choose an organization
          </h1>
          <p class="mt-1 text-sm text-text-secondary">Organizations where the GitHub App is installed.</p>
        </header>
        ${this.renderState()}
      </section>
    `;
  }

  private renderState() {
    const state = this.state;
    if (state.status === "loading") {
      return html`<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
        ${[0, 1, 2].map(() => html`<div class="skeleton-shimmer h-18 rounded-lg"></div>`)}
      </div>`;
    }
    if (state.status === "error") return errorPanel(state.error, () => void this.load(true));
    const { orgs, installUrl } = state.data;
    if (orgs.length === 0) return this.renderNoOrg(installUrl);
    return html`
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">${orgs.map((org) => this.renderOrg(org))}</div>
      ${installUrl
        ? html`<a href=${installUrl} target="_blank" rel="noopener noreferrer" class=${buttonClass({ variant: "link", size: "sm" })}>
            Install the GitHub App on another organization
          </a>`
        : nothing}
    `;
  }

  private renderOrg(org: OrgSummary) {
    return html`
      <a
        href=${`/orgs/${encodeURIComponent(org.login)}/dashboard`}
        class="group flex items-center gap-3 rounded-lg border border-border bg-surface p-4 shadow-card transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:border-primary hover:bg-surface-hover focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <img
          src=${sizedAvatar(org.avatarUrl, 80)}
          alt=""
          width="40"
          height="40"
          class="size-10 rounded-md border border-border"
        />
        <span class="min-w-0 flex-1">
          <span class="block truncate text-sm font-medium text-text-primary">${org.login}</span>
          <span class="block text-xs text-text-tertiary">
            ${org.repositorySelection === "all" ? "All repositories" : "Selected repositories"}
          </span>
        </span>
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" class="size-4 shrink-0 text-text-tertiary transition-transform duration-[var(--duration-fast)] group-hover:translate-x-0.5 group-hover:text-primary-text">
          <path d="M6 3.5L10.5 8 6 12.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"></path>
        </svg>
      </a>
    `;
  }

  private renderNoOrg(installUrl: string | null) {
    return html`
      <section class="rounded-lg border border-border bg-surface shadow-card">
        <app-empty-state
          class="block"
          size="page"
          variant="empty"
          heading="No organization yet"
          description="Install the GitHub App on your organization (on GitHub: the app's page › Install App), then come back here."
        >
          <div slot="action" class="flex items-center gap-2">
            ${installUrl
              ? html`<a href=${installUrl} target="_blank" rel="noopener noreferrer" class=${buttonClass({ size: "sm" })}>Install the app</a>`
              : nothing}
            <button type="button" class=${buttonClass({ variant: "outline", size: "sm" })} @click=${() => void this.load(true)}>
              Reload
            </button>
          </div>
        </app-empty-state>
      </section>
    `;
  }

  private async load(fresh: boolean): Promise<void> {
    this.state = { status: "loading" };
    try {
      this.state = { status: "ready", data: await api.orgs({ fresh }) };
    } catch (err) {
      this.state = { status: "error", error: asLoadError(err) };
    }
  }
}
