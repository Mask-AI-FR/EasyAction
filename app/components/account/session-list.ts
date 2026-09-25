import { html, nothing } from "lit";
import { Component, Reactive, TiniComponent } from "@tinijs/core";
import type { AccountSession, AccountSessionsBody } from "../../../domain/accountContract.ts";
import { api, ApiError, asLoadError, type LoadState } from "../../services/api-client.ts";
import { forgetSession } from "../../stores/session-store.ts";
import { showToast } from "../../stores/toast-store.ts";
import { sharedSheet } from "../../styles/shared-sheet.ts";
import { buttonClass } from "../../ui/button-classes.ts";
import { cn } from "../../ui/class-names.ts";
import { BADGE_CLASS, BADGE_TONE } from "../../ui/field-classes.ts";
import { shieldLoader } from "../../ui/shield-loader.ts";
import { errorPanel } from "../empty-state.ts";

/** Dates complètes (pas de « il y a 3 jours ») : on compare des sessions entre elles. */
const DATE = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });
const formatted = (iso: string): string => DATE.format(new Date(iso));

/**
 * Les sessions ouvertes de la personne (un navigateur chacune) : fermer les autres, ou toutes. Fermer
 * une session révoque aussi l'accès GitHub qu'elle détenait (côté serveur).
 */
@Component({ name: "app-session-list" })
export class AppSessionList extends TiniComponent {
  static override styles = [sharedSheet];

  @Reactive() private state: LoadState<AccountSessionsBody> = { status: "loading" };
  @Reactive() private busy: "others" | "all" | null = null;

  onCreate(): void {
    void this.load();
  }

  protected override render() {
    return html`
      <section class="rounded-lg border border-border bg-surface p-5 shadow-card" aria-labelledby="sessions-heading">
        <h2 id="sessions-heading" class="text-base font-semibold text-text-primary">Sessions</h2>
        <p class="mt-1 text-sm text-text-secondary">
          Browsers where you are signed in. Signing a browser out also revokes the GitHub access it holds.
        </p>
        ${this.renderState()}
      </section>
    `;
  }

  private renderState() {
    const state = this.state;
    if (state.status === "loading") {
      return html`<div class="skeleton-shimmer mt-4 h-(--row-height) rounded-md" aria-busy="true"></div>`;
    }
    if (state.status === "error") return html`<div class="mt-4">${errorPanel(state.error, () => void this.load())}</div>`;
    const { sessions } = state.data;
    const others = sessions.filter((session) => !session.current).length;
    return html`
      <ul class="mt-4 divide-y divide-border rounded-md border border-border" aria-label="Your sessions">
        ${sessions.map((session) => this.renderSession(session))}
      </ul>
      <div class="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          class=${buttonClass({ variant: "outline", size: "sm" })}
          ?disabled=${others === 0 || this.busy !== null}
          aria-busy=${this.busy === "others" ? "true" : "false"}
          @click=${this.signOutOthers}
        >
          ${this.busy === "others" ? shieldLoader(16) : nothing} Sign out other sessions
        </button>
        <button
          type="button"
          class=${buttonClass({ variant: "outline", size: "sm" })}
          ?disabled=${this.busy !== null}
          aria-busy=${this.busy === "all" ? "true" : "false"}
          @click=${this.signOutEverywhere}
        >
          ${this.busy === "all" ? shieldLoader(16) : nothing} Sign out everywhere
        </button>
      </div>
    `;
  }

  private renderSession(session: AccountSession) {
    return html`<li class="flex min-h-(--row-height) flex-wrap items-center gap-x-4 gap-y-1 px-(--row-padding-x) py-(--row-padding-y)">
      <span class="text-sm font-medium text-text-primary">${session.current ? "This browser" : "Another browser"}</span>
      ${session.current ? html`<span class=${cn(BADGE_CLASS, BADGE_TONE.outline)}>Current</span>` : nothing}
      <span class="text-xs text-text-secondary">Signed in ${formatted(session.createdAt)}</span>
      <span class="text-xs text-text-secondary">Last active ${formatted(session.lastSeenAt)}</span>
      <span class="text-xs text-text-tertiary">Ends ${formatted(session.expiresAt)}</span>
    </li>`;
  }

  private async load(): Promise<void> {
    this.state = { status: "loading" };
    try {
      this.state = { status: "ready", data: await api.account.sessions() };
    } catch (err) {
      this.state = { status: "error", error: asLoadError(err) };
    }
  }

  private async signOutOthers(): Promise<void> {
    this.busy = "others";
    try {
      const { ended } = await api.account.signOutOthers();
      showToast({ tone: "success", title: `Signed out of ${ended} other ${ended === 1 ? "session" : "sessions"}` });
      await this.load();
    } catch (err) {
      if (!(err instanceof ApiError || err instanceof TypeError)) throw err;
      showToast({ tone: "error", title: "Could not sign out the other sessions", description: "Please try again." });
    } finally {
      this.busy = null;
    }
  }

  /**
   * ÉCHEC FERMÉ : tant que le serveur n'a pas confirmé, on ne prétend pas être déconnecté. Ensuite,
   * rechargement complet vers la connexion (aucun état de la session ne survit).
   */
  private async signOutEverywhere(): Promise<void> {
    this.busy = "all";
    try {
      await api.account.signOutEverywhere();
      forgetSession();
      location.assign("/login");
    } catch (err) {
      if (!(err instanceof ApiError || err instanceof TypeError)) throw err;
      showToast({ tone: "error", title: "Could not sign out everywhere", description: "Please try again." });
      this.busy = null;
    }
  }
}
