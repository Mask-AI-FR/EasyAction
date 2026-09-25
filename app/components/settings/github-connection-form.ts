import { html, nothing, type PropertyValues } from "lit";
import { live } from "lit/directives/live.js";
import { Component, Input, Reactive, TiniComponent } from "@tinijs/core";
import { apiUrlFor } from "../../../domain/githubHosts.ts";
import { GITHUB_FIELDS, type GitHubFieldDefinition, type GitHubSettingKey } from "../../../domain/settingsCatalog.ts";
import type { GitHubConnectionView } from "../../../domain/settingsContract.ts";
import { api, ApiError, errorCopy } from "../../services/api-client.ts";
import { forgetSession } from "../../stores/session-store.ts";
import { showToast } from "../../stores/toast-store.ts";
import { sharedSheet } from "../../styles/shared-sheet.ts";
import { buttonClass } from "../../ui/button-classes.ts";
import { cn } from "../../ui/class-names.ts";
import { INPUT_CLASS } from "../../ui/field-classes.ts";
import { brandSpinner } from "../../ui/brand-mark.ts";
import "./code-dialog.ts";

interface Draft {
  readonly webUrl: string;
  readonly apiUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
}

/** Champ du catalogue → champ du brouillon (les libellés et aides viennent du catalogue). */
const DRAFT_KEY: Readonly<Record<GitHubSettingKey, keyof Draft>> = {
  githubWebUrl: "webUrl",
  githubApiUrl: "apiUrl",
  githubClientId: "clientId",
  githubClientSecret: "clientSecret",
};

/**
 * La connexion à GitHub : adresses, identifiant et secret de l'app GitHub, enregistrés ensemble avec
 * un code à 6 chiffres. L'adresse d'API suit l'adresse web tant qu'on ne la touche pas. Le secret
 * n'est jamais relu : il se retape à chaque enregistrement. Changer d'adresse ou d'identifiant
 * déconnecte tout le monde (le serveur le fait ; la page renvoie alors vers la connexion).
 */
@Component({ name: "app-github-connection-form" })
export class AppGitHubConnectionForm extends TiniComponent {
  static override styles = [sharedSheet];

  @Input({ attribute: false }) connection: GitHubConnectionView | null = null;
  @Reactive() private draft: Draft = { webUrl: "", apiUrl: "", clientId: "", clientSecret: "" };
  @Reactive() private apiTouched = false;
  @Reactive() private testing = false;
  @Reactive() private testResult: { ok: boolean; message: string } | null = null;
  @Reactive() private confirming = false;
  @Reactive() private saving = false;
  @Reactive() private saveError = "";

  onChanges(changed: PropertyValues<this>): void {
    const connection = this.connection;
    if (!changed.has("connection") || !connection) return;
    this.draft = { webUrl: connection.webUrl, apiUrl: connection.apiUrl, clientId: connection.clientId, clientSecret: "" };
    this.apiTouched = false;
  }

  protected override render() {
    const connection = this.connection;
    if (!connection) return nothing;
    return html`<section class="rounded-lg border border-border bg-surface p-5 shadow-card" aria-labelledby="github-heading">
      <h2 id="github-heading" class="text-base font-semibold text-text-primary">GitHub connection</h2>
      <p class="mt-1 text-sm text-text-secondary">The GitHub App that EasyActions signs in with, on github.com or your GitHub Enterprise Server.</p>
      <p class="mt-3 rounded-md bg-signal-warning-soft px-3 py-2 text-xs text-signal-warning-text">
        Changing the address or the client ID signs everyone out, you included. Every GitHub token is sent to these
        addresses: only trusted administrators should change them.
      </p>
      <div class="mt-5 grid gap-4 sm:grid-cols-2">
        ${GITHUB_FIELDS.map((field) => this.renderField(field, connection.clientSecretSet))}
      </div>
      ${this.testResult
        ? html`<p role="status" class=${this.testResult.ok ? "mt-4 text-xs text-signal-success-text" : "mt-4 text-xs text-signal-danger-text"}>
            ${this.testResult.message}
          </p>`
        : nothing}
      <div class="mt-5 flex flex-wrap gap-2">
        <button type="button" class=${buttonClass({ variant: "outline" })} ?disabled=${this.testing} @click=${this.test}>
          ${this.testing ? brandSpinner(16) : nothing} Test connection
        </button>
        <button type="button" class=${buttonClass()} ?disabled=${!this.complete()} @click=${() => (this.confirming = true)}>
          Save connection
        </button>
      </div>
      <app-code-dialog
        .open=${this.confirming}
        heading="Save the GitHub connection?"
        description="If the address or the client ID changed, everyone is signed out and signs in again with the new GitHub App."
        confirmLabel="Save"
        .busy=${this.saving}
        .error=${this.saveError}
        @dismiss=${() => !this.saving && (this.confirming = false)}
        @code-confirm=${(event: CustomEvent<string>) => void this.save(event.detail)}
      ></app-code-dialog>
    </section>`;
  }

  /** Un champ du catalogue ; le secret est masqué et, s'il est déjà enregistré, il faut le retaper. */
  private renderField(field: GitHubFieldDefinition, secretSaved: boolean) {
    const key = DRAFT_KEY[field.key];
    const secret = field.kind === "secret";
    return html`<label class="block space-y-1">
      <span class="text-sm font-medium text-text-primary">${field.label}${secret && secretSaved ? " (saved)" : ""}</span>
      <span class="block text-xs text-text-secondary">${field.help}</span>
      <input
        class=${cn(INPUT_CLASS, "mt-1 font-mono")}
        type=${secret ? "password" : "text"}
        autocomplete=${secret ? "new-password" : "off"}
        spellcheck="false"
        .value=${live(this.draft[key])}
        @input=${(event: Event) => this.edit(key, (event.target as HTMLInputElement).value)}
      />
    </label>`;
  }

  private edit(key: keyof Draft, value: string): void {
    this.testResult = null;
    if (key === "apiUrl") this.apiTouched = true;
    const suggested = key === "webUrl" && !this.apiTouched ? apiUrlFor(value.trim()) : null;
    this.draft = { ...this.draft, [key]: value, ...(suggested ? { apiUrl: suggested } : {}) };
  }

  private complete(): boolean {
    const { webUrl, apiUrl, clientId, clientSecret } = this.draft;
    return [webUrl, apiUrl, clientId, clientSecret].every((value) => value.trim() !== "");
  }

  private async test(): Promise<void> {
    this.testing = true;
    try {
      this.testResult = await api.admin.testConnection(this.draft.webUrl.trim(), this.draft.apiUrl.trim());
    } catch (err) {
      if (!(err instanceof ApiError || err instanceof TypeError)) throw err;
      this.testResult = { ok: false, message: err instanceof ApiError ? errorMessage(err) : "EasyActions is unreachable." };
    } finally {
      this.testing = false;
    }
  }

  private async save(code: string): Promise<void> {
    this.saving = true;
    this.saveError = "";
    try {
      const { webUrl, apiUrl, clientId, clientSecret } = this.draft;
      const saved = await api.admin.saveConnection({ webUrl: webUrl.trim(), apiUrl: apiUrl.trim(), clientId: clientId.trim(), clientSecret, code });
      if (saved.signedEveryoneOut) {
        forgetSession();
        location.assign("/login");
        return;
      }
      this.confirming = false;
      this.draft = { ...this.draft, clientSecret: "" };
      showToast({ tone: "success", title: "GitHub connection saved" });
      this.emitEvent("connection-saved");
    } catch (err) {
      if (!(err instanceof ApiError || err instanceof TypeError)) throw err;
      this.saveError = err instanceof ApiError ? errorMessage(err) : "EasyActions is unreachable.";
    } finally {
      this.saving = false;
    }
  }
}

/** Message d'un refus du serveur : le sien quand il explique (paire, test), sinon le texte générique. */
function errorMessage(error: ApiError): string {
  return error.code === "bad_request" && error.serverMessage ? error.serverMessage : errorCopy(error).description;
}
