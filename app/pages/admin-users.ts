import { html, nothing } from "lit";
import { Page, Reactive, TiniComponent } from "@tinijs/core";
import type { AdminUsersBody, AdminUserView } from "../../domain/adminContract.ts";
import { api, ApiError, asLoadError, errorCopy, type LoadState } from "../services/api-client.ts";
import { sessionStore } from "../stores/session-store.ts";
import { showToast } from "../stores/toast-store.ts";
import { sharedSheet } from "../styles/shared-sheet.ts";
import { buttonClass } from "../ui/button-classes.ts";
import { cn } from "../ui/class-names.ts";
import { BADGE_CLASS, BADGE_TONE } from "../ui/field-classes.ts";
import { adminOnlyPanel } from "../components/empty-state.ts";
import "../components/settings/code-dialog.ts";

type SensitiveAction = "promote" | "demote" | "reset" | "delete";

/** Libellés des actions sensibles (boîte de confirmation par code). */
const ACTIONS: Record<SensitiveAction, { heading: (login: string) => string; description: string; confirm: string; destructive: boolean }> = {
  promote: { heading: (login) => `Make ${login} an administrator?`, description: "Administrators change the GitHub connection, the limits and the other users.", confirm: "Make admin", destructive: false },
  demote: { heading: (login) => `Remove ${login}'s admin role?`, description: "EasyActions always keeps at least one administrator.", confirm: "Remove admin", destructive: false },
  reset: { heading: (login) => `Remove ${login}'s authenticator app?`, description: "Every browser of this person must set up an authenticator app again at the next visit.", confirm: "Remove app", destructive: true },
  delete: { heading: (login) => `Delete ${login}'s EasyActions data?`, description: "Signs this person out everywhere and deletes their login, sessions and history. Their GitHub account is not touched.", confirm: "Delete", destructive: true },
};

const DATE = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });

/** La page Users : les personnes qui se sont connectées, leur rôle et leur code du jour. */
@Page({ name: "app-page-admin-users" })
export class AppPageAdminUsers extends TiniComponent {
  static override styles = [sharedSheet];

  @Reactive() private state: LoadState<AdminUsersBody> = { status: "loading" };
  @Reactive() private pending: { readonly action: SensitiveAction; readonly user: AdminUserView } | null = null;
  @Reactive() private busy = false;
  @Reactive() private error = "";

  onCreate(): void {
    void this.load();
  }

  protected override render() {
    const pending = this.pending;
    return html`
      <section class="mx-auto max-w-5xl space-y-5">
        <header>
          <p class="t-eyebrow">Administration</p>
          <h1 class="mt-1 text-xl font-semibold tracking-tight text-text-primary">Users</h1>
          <p class="mt-1 text-sm text-text-secondary">People who signed in to EasyActions. Access itself is governed by GitHub.</p>
        </header>
        ${this.renderState()}
      </section>
      <app-code-dialog
        .open=${pending !== null}
        heading=${pending ? ACTIONS[pending.action].heading(pending.user.login) : ""}
        description=${pending ? ACTIONS[pending.action].description : ""}
        confirmLabel=${pending ? ACTIONS[pending.action].confirm : ""}
        .destructive=${pending ? ACTIONS[pending.action].destructive : false}
        .busy=${this.busy}
        .error=${this.error}
        @dismiss=${() => !this.busy && (this.pending = null)}
        @code-confirm=${(event: CustomEvent<string>) => void this.run(event.detail)}
      ></app-code-dialog>
    `;
  }

  private renderState() {
    const state = this.state;
    if (state.status === "loading") return html`<div class="skeleton-shimmer h-48 rounded-lg" aria-busy="true"></div>`;
    if (state.status === "error") return adminOnlyPanel(state.error, () => void this.load());
    return html`<div class="overflow-x-auto rounded-lg border border-border bg-surface shadow-card">
      <table class="w-full text-left text-sm">
        <thead class="t-eyebrow bg-surface-secondary">
          <tr>
            <th scope="col" class="px-(--row-padding-x) py-2.5">Person</th>
            <th scope="col" class="px-(--row-padding-x) py-2.5">Role</th>
            <th scope="col" class="px-(--row-padding-x) py-2.5">Daily code</th>
            <th scope="col" class="px-(--row-padding-x) py-2.5">Browsers</th>
            <th scope="col" class="px-(--row-padding-x) py-2.5">Last sign-in</th>
            <th scope="col" class="px-(--row-padding-x) py-2.5"><span class="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>${state.data.users.map((user) => this.renderUser(user))}</tbody>
      </table>
    </div>`;
  }

  private renderUser(user: AdminUserView) {
    const me = user.login === sessionStore.session?.user.login;
    const action = buttonClass({ variant: "ghost", size: "xs" });
    return html`<tr class="border-t border-border hover:bg-surface-hover">
      <td class="px-(--row-padding-x) py-(--row-padding-y)">
        <span class="flex items-center gap-2.5">
          <img src=${user.avatarUrl} alt="" width="24" height="24" class="size-6 rounded-full border border-border" />
          <span class="font-medium text-text-primary">${user.login}</span>
          ${me ? html`<span class=${cn(BADGE_CLASS, BADGE_TONE.outline)}>You</span>` : nothing}
        </span>
      </td>
      <td class="px-(--row-padding-x)">
        <span class=${cn(BADGE_CLASS, user.role === "admin" ? "bg-primary-soft text-primary-text" : BADGE_TONE.neutral)}>
          ${user.role === "admin" ? "Admin" : "Member"}
        </span>
      </td>
      <td class="px-(--row-padding-x) text-text-secondary">${user.twoFactorEnabled ? "On" : "Not set up"}</td>
      <td class="px-(--row-padding-x) text-text-secondary">${user.sessions}</td>
      <td class="px-(--row-padding-x) text-xs text-text-secondary">${DATE.format(new Date(user.lastSignInAt))}</td>
      <td class="px-(--row-padding-x)">
        <span class="flex flex-wrap justify-end gap-1">
          <button type="button" class=${action} @click=${() => this.ask(user.role === "admin" ? "demote" : "promote", user)}>
            ${user.role === "admin" ? "Remove admin" : "Make admin"}
          </button>
          ${user.twoFactorEnabled ? html`<button type="button" class=${action} @click=${() => this.ask("reset", user)}>Reset code</button>` : nothing}
          ${me ? nothing : this.renderOtherActions(user, action)}
        </span>
      </td>
    </tr>`;
  }

  /** Pas pour sa propre ligne : la page Account fait la même chose (« Sign out everywhere », « Delete my data »). */
  private renderOtherActions(user: AdminUserView, action: string) {
    return html`<button type="button" class=${action} ?disabled=${user.sessions === 0} @click=${() => void this.signOut(user)}>Sign out</button>
      <button type="button" class=${action} @click=${() => this.ask("delete", user)}>Delete</button>`;
  }

  private ask(action: SensitiveAction, user: AdminUserView): void {
    this.error = "";
    this.pending = { action, user };
  }

  private async load(): Promise<void> {
    try {
      this.state = { status: "ready", data: await api.admin.users() };
    } catch (err) {
      this.state = { status: "error", error: asLoadError(err) };
    }
  }

  private async run(code: string): Promise<void> {
    const pending = this.pending;
    if (!pending) return;
    this.busy = true;
    this.error = "";
    try {
      await this.send(pending.action, pending.user.githubId, code);
      if (pending.action === "demote" && pending.user.login === sessionStore.session?.user.login) {
        // Plus administrateur : rechargement complet, pour que la barre latérale perde sa section Administration.
        location.assign("/orgs");
        return;
      }
      this.pending = null;
      showToast({ tone: "success", title: `${ACTIONS[pending.action].confirm}: done for ${pending.user.login}` });
      await this.load();
    } catch (err) {
      if (!(err instanceof ApiError || err instanceof TypeError)) throw err;
      this.error = err instanceof ApiError && err.serverMessage && err.code === "bad_request" ? err.serverMessage : errorCopy(err instanceof ApiError ? err : null).description;
    } finally {
      this.busy = false;
    }
  }

  private send(action: SensitiveAction, id: number, code: string): Promise<void> {
    if (action === "promote") return api.admin.changeRole(id, "admin", code);
    if (action === "demote") return api.admin.changeRole(id, "member", code);
    if (action === "reset") return api.admin.resetTwoFactor(id, code);
    return api.admin.deleteUser(id, code);
  }

  /** Fermer les sessions de quelqu'un est sans risque : pas de code demandé (le serveur n'en exige pas). */
  private async signOut(user: AdminUserView): Promise<void> {
    try {
      const { ended } = await api.admin.signOutUser(user.githubId);
      showToast({ tone: "success", title: `${user.login} signed out of ${ended} ${ended === 1 ? "browser" : "browsers"}` });
      await this.load();
    } catch (err) {
      if (!(err instanceof ApiError || err instanceof TypeError)) throw err;
      showToast({ tone: "error", title: "Sign-out failed", description: errorCopy(err instanceof ApiError ? err : null).description });
    }
  }
}
