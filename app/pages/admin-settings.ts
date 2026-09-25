import { html } from "lit";
import { Page, Reactive, TiniComponent } from "@tinijs/core";
import type { SettingsBody } from "../../domain/settingsContract.ts";
import { api, asLoadError, type LoadState } from "../services/api-client.ts";
import { sharedSheet } from "../styles/shared-sheet.ts";
import { adminOnlyPanel } from "../components/empty-state.ts";
import "../components/settings/github-connection-form.ts";
import "../components/settings/limits-form.ts";

/** La page Settings : connexion à GitHub et plafonds (les réglages de sécurité restent dans `.env`). */
@Page({ name: "app-page-admin-settings" })
export class AppPageAdminSettings extends TiniComponent {
  static override styles = [sharedSheet];

  @Reactive() private state: LoadState<SettingsBody> = { status: "loading" };

  onCreate(): void {
    void this.load();
  }

  protected override render() {
    return html`
      <section class="mx-auto max-w-4xl space-y-5">
        <header>
          <p class="t-eyebrow">Administration</p>
          <h1 class="mt-1 text-xl font-semibold tracking-tight text-text-primary">Settings</h1>
          <p class="mt-1 text-sm text-text-secondary">
            Sessions, the daily code and the history keep their settings in the server's <span class="font-mono">.env</span>.
          </p>
        </header>
        ${this.renderState()}
      </section>
    `;
  }

  private renderState() {
    const state = this.state;
    if (state.status === "loading") return html`<div class="skeleton-shimmer h-72 rounded-lg" aria-busy="true"></div>`;
    if (state.status === "error") return adminOnlyPanel(state.error, () => void this.load());
    return html`
      <app-github-connection-form class="block" .connection=${state.data.github} @connection-saved=${() => void this.load()}></app-github-connection-form>
      <app-limits-form
        class="block"
        .limits=${state.data.limits}
        @limits-saved=${(event: CustomEvent<SettingsBody>) => (this.state = { status: "ready", data: event.detail })}
      ></app-limits-form>
    `;
  }

  private async load(): Promise<void> {
    this.state = { status: "loading" };
    try {
      this.state = { status: "ready", data: await api.admin.settings() };
    } catch (err) {
      this.state = { status: "error", error: asLoadError(err) };
    }
  }
}
