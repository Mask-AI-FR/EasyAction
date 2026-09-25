import { html, nothing } from "lit";
import { live } from "lit/directives/live.js";
import { Page, Reactive, TiniComponent } from "@tinijs/core";
import type { OnBeforeEnter } from "@tinijs/router";
import { apiUrlFor } from "../../domain/githubHosts.ts";
import { GITHUB_FIELDS, type GitHubFieldDefinition, type GitHubSettingKey } from "../../domain/settingsCatalog.ts";
import { api, ApiError, errorCopy, signInUrl } from "../services/api-client.ts";
import { sharedSheet } from "../styles/shared-sheet.ts";
import { brandMark, brandSpinner, wordmark } from "../ui/brand-mark.ts";
import { buttonClass } from "../ui/button-classes.ts";
import { cn } from "../ui/class-names.ts";
import { INPUT_CLASS } from "../ui/field-classes.ts";

interface Draft {
  readonly setupCode: string;
  readonly webUrl: string;
  readonly apiUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
}

/** Champ du catalogue → champ du brouillon (libellés et aides : `domain/settingsCatalog.ts`). */
const DRAFT_KEY: Readonly<Record<GitHubSettingKey, keyof Draft>> = {
  githubWebUrl: "webUrl",
  githubApiUrl: "apiUrl",
  githubClientId: "clientId",
  githubClientSecret: "clientSecret",
};

/** Exemples dans les champs vides : des indications, jamais des valeurs par défaut (CLAUDE.md §6.3). */
const PLACEHOLDERS: Readonly<Record<GitHubSettingKey, string>> = {
  githubWebUrl: "https://github.com",
  githubApiUrl: "https://api.github.com",
  githubClientId: "Iv23li…",
  githubClientSecret: "",
};

/** Message d'un refus : le texte du serveur quand il explique (code, paire, test), sinon le texte générique. */
function messageOf(err: unknown): string {
  if (err instanceof ApiError) {
    const explained = err.code === "bad_request" || err.code === "invalid_code" || err.code === "not_found";
    return explained && err.serverMessage ? err.serverMessage : errorCopy(err).description;
  }
  return "EasyActions is unreachable. Check that the server is running, then try again.";
}

/**
 * Installation (`/setup`) : tant que le serveur n'a pas de connexion à GitHub, on y saisit le code
 * d'installation (`bun run settings:setup-code`, sur le serveur), les adresses GitHub, l'identifiant et
 * le secret de l'app GitHub. Rien de tout cela dans `.env`. Ensuite, la page Settings seule les change.
 * Le serveur revérifie tout ; cette page n'est qu'un confort.
 */
@Page({ name: "app-page-setup" })
export class AppPageSetup extends TiniComponent implements OnBeforeEnter {
  static override styles = [sharedSheet];

  @Reactive() private draft: Draft = { setupCode: "", webUrl: "", apiUrl: "", clientId: "", clientSecret: "" };
  @Reactive() private apiTouched = false;
  @Reactive() private testing = false;
  @Reactive() private saving = false;
  @Reactive() private result: { readonly ok: boolean; readonly message: string } | null = null;
  @Reactive() private done = false;

  /** Déjà installé : direction la connexion. ÉCHEC OUVERT si le serveur ne répond pas : la page s'affiche, chaque envoi dira l'erreur. */
  async onBeforeEnter(): Promise<string | undefined> {
    const status = await api.setup.status().catch(() => null);
    return status && !status.required ? "/login" : undefined;
  }

  protected override render() {
    return html`<main class="grid min-h-dvh place-items-center bg-background px-6 py-10">
      <section class="w-full max-w-xl rounded-2xl border border-border bg-surface p-8 shadow-card sm:p-10">
        <div class="flex items-center gap-3.5">${brandMark(48)} ${wordmark("lg")}</div>
        ${this.done ? this.renderDone() : this.renderForm()}
      </section>
    </main>`;
  }

  private renderForm() {
    return html`<h1 class="mt-8 text-lg font-semibold tracking-tight text-text-primary">Set up EasyActions</h1>
      <p class="mt-1 text-sm text-text-secondary">
        Connect EasyActions to your GitHub App. You do this once; afterwards administrators change it on the Settings page.
      </p>
      <label class="mt-6 block space-y-1">
        <span class="text-sm font-medium text-text-primary">Setup code</span>
        <span class="block text-xs text-text-secondary">
          On the server, in the EasyActions folder, run <span class="font-mono text-text-primary">bun run settings:setup-code</span>
          and type the code it prints. It works for 30 minutes.
        </span>
        <input
          class=${cn(INPUT_CLASS, "mt-1 font-mono tracking-wide uppercase")}
          autocomplete="off"
          spellcheck="false"
          .value=${live(this.draft.setupCode)}
          @input=${(event: Event) => this.edit("setupCode", (event.target as HTMLInputElement).value)}
        />
      </label>
      <div class="mt-6 grid gap-4 sm:grid-cols-2">${GITHUB_FIELDS.map((field) => this.renderField(field))}</div>
      ${this.result
        ? html`<p role="status" class=${this.result.ok ? "mt-4 text-xs text-signal-success-text" : "mt-4 text-xs text-signal-danger-text"}>
            ${this.result.message}
          </p>`
        : nothing}
      <div class="mt-6 flex flex-wrap gap-2">
        <button type="button" class=${buttonClass({ variant: "outline" })} ?disabled=${this.testing || this.saving} @click=${this.test}>
          ${this.testing ? brandSpinner(16) : nothing} Test connection
        </button>
        <button type="button" class=${buttonClass()} ?disabled=${!this.complete() || this.saving} aria-busy=${this.saving ? "true" : "false"} @click=${this.save}>
          ${this.saving ? brandSpinner(16) : nothing} Save and finish
        </button>
      </div>`;
  }

  private renderField(field: GitHubFieldDefinition) {
    const key = DRAFT_KEY[field.key];
    const secret = field.kind === "secret";
    return html`<label class="block space-y-1">
      <span class="text-sm font-medium text-text-primary">${field.label}</span>
      <span class="block text-xs text-text-secondary">${field.help}</span>
      <input
        class=${cn(INPUT_CLASS, "mt-1 font-mono")}
        type=${secret ? "password" : "text"}
        autocomplete=${secret ? "new-password" : "off"}
        spellcheck="false"
        placeholder=${PLACEHOLDERS[field.key]}
        .value=${live(this.draft[key])}
        @input=${(event: Event) => this.edit(key, (event.target as HTMLInputElement).value)}
      />
    </label>`;
  }

  /** Après l'installation : se connecter, mettre en place le code du jour, devenir administrateur. */
  private renderDone() {
    return html`<h1 class="mt-8 text-lg font-semibold tracking-tight text-text-primary">EasyActions is set up</h1>
      <ol class="mt-4 list-decimal space-y-2 pl-5 text-sm text-text-secondary">
        <li>Sign in with GitHub, then set up your authenticator app when asked.</li>
        <li>
          On the server, make yourself the administrator, with your GitHub login:
          <span class="mt-1 block font-mono text-text-primary">bun run users:promote your-github-login</span>
        </li>
      </ol>
      <a href=${signInUrl("/orgs")} router-ignore class=${cn(buttonClass({ size: "lg" }), "mt-7 w-full")}>Sign in with GitHub</a>`;
  }

  /** L'adresse d'API suit l'adresse web tant qu'on ne la touche pas (même règle que la page Settings). */
  private edit(key: keyof Draft, value: string): void {
    this.result = null;
    if (key === "apiUrl") this.apiTouched = true;
    const suggested = key === "webUrl" && !this.apiTouched ? apiUrlFor(value.trim()) : null;
    this.draft = { ...this.draft, [key]: value, ...(suggested ? { apiUrl: suggested } : {}) };
  }

  private complete(): boolean {
    return Object.values(this.draft).every((value) => value.trim() !== "");
  }

  private async test(): Promise<void> {
    this.testing = true;
    try {
      const { setupCode, webUrl, apiUrl } = this.draft;
      this.result = await api.setup.test({ setupCode: setupCode.trim(), webUrl: webUrl.trim(), apiUrl: apiUrl.trim() });
    } catch (err) {
      if (!(err instanceof ApiError || err instanceof TypeError)) throw err;
      this.result = { ok: false, message: messageOf(err) };
    } finally {
      this.testing = false;
    }
  }

  private async save(): Promise<void> {
    this.saving = true;
    try {
      const { setupCode, webUrl, apiUrl, clientId, clientSecret } = this.draft;
      await api.setup.save({ setupCode: setupCode.trim(), webUrl: webUrl.trim(), apiUrl: apiUrl.trim(), clientId: clientId.trim(), clientSecret });
      this.draft = { ...this.draft, clientSecret: "" };
      this.done = true;
    } catch (err) {
      if (!(err instanceof ApiError || err instanceof TypeError)) throw err;
      this.result = { ok: false, message: messageOf(err) };
    } finally {
      this.saving = false;
    }
  }
}
