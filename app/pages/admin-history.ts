import { html, nothing } from "lit";
import { Page, Reactive, TiniComponent } from "@tinijs/core";
import type { HistoryEntryView } from "../../domain/adminContract.ts";
import { AUDIT_ACTIONS, type AuditAction } from "../../domain/auditActions.ts";
import { api, ApiError, asLoadError, type LoadState } from "../services/api-client.ts";
import { sharedSheet } from "../styles/shared-sheet.ts";
import { buttonClass } from "../ui/button-classes.ts";
import { SELECT_CLASS } from "../ui/field-classes.ts";
import { adminOnlyPanel } from "../components/empty-state.ts";

/** Libellés anglais des actions de l'historique (toutes : `Record` vérifié par le compilateur). */
const LABELS: Record<AuditAction, string> = {
  "session.create": "Signed in",
  "session.end": "Signed out",
  "session.end_others": "Signed out other browsers",
  "session.end_all": "Signed out everywhere",
  "account.export": "Downloaded their data",
  "account.delete": "Deleted their data",
  "two_factor.enroll": "Set up the authenticator app",
  "two_factor.verify": "Gave the daily code",
  "two_factor.fail": "Wrong code",
  "two_factor.lock": "Codes locked (too many wrong codes)",
  "two_factor.recovery_used": "Used a recovery code",
  "two_factor.recovery_regenerated": "Made new recovery codes",
  "two_factor.reset": "Authenticator app removed",
  "settings.update": "Changed limits",
  "settings.github_update": "Changed the GitHub connection",
  "settings.import": "Imported settings from .env",
  "settings.setup": "Set up the GitHub connection (setup page)",
  "settings.reset": "Cleared the GitHub connection (server command)",
  "user.role_change": "Changed a role",
  "user.sign_out": "Signed someone out",
  "user.remove": "Deleted someone",
};

/** En UTC, comme le dit l'en-tête de colonne (l'historique sert à recouper des journaux serveur). */
const DATE = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "medium", timeZone: "UTC" });

/** La page History : l'historique de sécurité, du plus récent au plus ancien, par pages. */
@Page({ name: "app-page-admin-history" })
export class AppPageAdminHistory extends TiniComponent {
  static override styles = [sharedSheet];

  @Reactive() private state: LoadState<readonly HistoryEntryView[]> = { status: "loading" };
  @Reactive() private action: AuditAction | null = null;
  @Reactive() private nextBefore: number | null = null;
  @Reactive() private loadingMore = false;

  onCreate(): void {
    void this.load();
  }

  protected override render() {
    return html`
      <section class="mx-auto max-w-5xl space-y-5">
        <header class="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p class="t-eyebrow">Administration</p>
            <h1 class="mt-1 text-xl font-semibold tracking-tight text-text-primary">History</h1>
            <p class="mt-1 text-sm text-text-secondary">Sign-ins and security actions, kept for the time set in the server's .env.</p>
          </div>
          <label>
            <span class="sr-only">Action</span>
            <select class=${SELECT_CLASS} @change=${this.onFilter}>
              <option value="" ?selected=${this.action === null}>All actions</option>
              ${AUDIT_ACTIONS.map((action) => html`<option value=${action} ?selected=${this.action === action}>${LABELS[action]}</option>`)}
            </select>
          </label>
        </header>
        ${this.renderState()}
      </section>
    `;
  }

  private renderState() {
    const state = this.state;
    if (state.status === "loading") return html`<div class="skeleton-shimmer h-48 rounded-lg" aria-busy="true"></div>`;
    if (state.status === "error") return adminOnlyPanel(state.error, () => void this.load());
    if (state.data.length === 0) return html`<p class="text-sm text-text-secondary">Nothing yet.</p>`;
    return html`<div class="overflow-x-auto rounded-lg border border-border bg-surface shadow-card">
        <table class="w-full text-left text-sm">
          <thead class="t-eyebrow bg-surface-secondary">
            <tr>
              <th scope="col" class="px-(--row-padding-x) py-2.5">When (UTC)</th>
              <th scope="col" class="px-(--row-padding-x) py-2.5">What</th>
              <th scope="col" class="px-(--row-padding-x) py-2.5">By</th>
              <th scope="col" class="px-(--row-padding-x) py-2.5">For</th>
            </tr>
          </thead>
          <tbody>${state.data.map((entry) => this.renderEntry(entry))}</tbody>
        </table>
      </div>
      ${this.nextBefore !== null
        ? html`<button type="button" class=${buttonClass({ variant: "outline", size: "sm" })} ?disabled=${this.loadingMore} @click=${this.loadMore}>
            Load older
          </button>`
        : nothing}`;
  }

  private renderEntry(entry: HistoryEntryView) {
    return html`<tr class="border-t border-border hover:bg-surface-hover">
      <td class="px-(--row-padding-x) py-(--row-padding-y) text-xs whitespace-nowrap text-text-secondary">
        ${DATE.format(new Date(entry.at))}
      </td>
      <td class="px-(--row-padding-x) text-text-primary">
        ${LABELS[entry.action]}
        ${entry.keys ? html`<span class="block font-mono text-2xs text-text-tertiary">${entry.keys.join(", ")}</span>` : nothing}
      </td>
      <td class="px-(--row-padding-x) whitespace-nowrap text-text-secondary">${entry.actor ?? html`<span class="text-text-tertiary">server command / deleted</span>`}</td>
      <td class="px-(--row-padding-x) whitespace-nowrap text-text-secondary">${entry.target ?? "—"}</td>
    </tr>`;
  }

  private onFilter(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.action = AUDIT_ACTIONS.find((action) => action === value) ?? null;
    void this.load();
  }

  private async load(): Promise<void> {
    this.state = { status: "loading" };
    try {
      const page = await api.admin.history(null, this.action);
      this.state = { status: "ready", data: page.entries };
      this.nextBefore = page.nextBefore;
    } catch (err) {
      this.state = { status: "error", error: asLoadError(err) };
    }
  }

  /** ÉCHEC OUVERT : une page de plus qui ne vient pas laisse la liste déjà lue et le bouton. */
  private async loadMore(): Promise<void> {
    const state = this.state;
    if (state.status !== "ready" || this.nextBefore === null) return;
    this.loadingMore = true;
    try {
      const page = await api.admin.history(this.nextBefore, this.action);
      this.state = { status: "ready", data: [...state.data, ...page.entries] };
      this.nextBefore = page.nextBefore;
    } catch (err) {
      if (!(err instanceof ApiError || err instanceof TypeError)) throw err;
    } finally {
      this.loadingMore = false;
    }
  }
}
