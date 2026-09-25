import { html, nothing } from "lit";
import { live } from "lit/directives/live.js";
import { Page, Reactive, TiniComponent } from "@tinijs/core";
import type { OnBeforeEnter } from "@tinijs/router";
import { isSameOriginPath } from "../../domain/returnTo.ts";
import { api, ApiError, errorCopy } from "../services/api-client.ts";
import { ensureSession, sessionStore } from "../stores/session-store.ts";
import { sharedSheet } from "../styles/shared-sheet.ts";
import { brandMark, wordmark } from "../ui/brand-mark.ts";
import { buttonClass } from "../ui/button-classes.ts";
import { cn } from "../ui/class-names.ts";
import { INPUT_CLASS } from "../ui/field-classes.ts";
import { shieldLoader } from "../ui/shield-loader.ts";
import "../components/two-factor/code-field.ts";
import "../components/two-factor/setup-steps.ts";

type Mode = "setup" | "verify" | "change";

/** Paramètre de l'adresse, lu dans `location.search` (le routeur de TiniJS garde en cache la requête). */
const queryParam = (name: string): string | null => new URLSearchParams(location.search).get(name);

function requestedReturnTo(): string {
  const candidate = queryParam("returnTo");
  return candidate && isSameOriginPath(candidate) ? candidate : "/orgs";
}

/**
 * Le code à 6 chiffres : mise en place de l'application (`setup`), code du jour (`verify`), ou
 * changement d'application depuis la page du compte (`change`, session déjà vérifiée). Une fois le
 * code accepté, rechargement complet vers la page demandée : la session a un nouvel identifiant et le
 * magasin de session doit être relu.
 */
@Page({ name: "app-page-two-factor" })
export class AppPageTwoFactor extends TiniComponent implements OnBeforeEnter {
  static override styles = [sharedSheet];

  @Reactive() private mode: Mode = "verify";
  @Reactive() private code = "";
  @Reactive() private recoveryCode = "";
  @Reactive() private useRecovery = false;
  @Reactive() private currentCode = "";
  @Reactive() private busy = false;
  @Reactive() private error = "";

  /** ÉCHEC FERMÉ : sans session → connexion ; déjà vérifié (hors changement) → page demandée. */
  async onBeforeEnter(): Promise<string | undefined> {
    const session = await ensureSession().catch(() => null);
    if (!session) return `/login?returnTo=${encodeURIComponent(location.pathname + location.search)}`;
    const changing = queryParam("mode") === "change" && session.secondFactor === "verified";
    if (session.secondFactor === "verified" && !changing) return requestedReturnTo();
    return undefined;
  }

  onCreate(): void {
    const state = sessionStore.session?.secondFactor;
    this.mode = state === "setup" ? "setup" : state === "verified" ? "change" : "verify";
  }

  protected override render() {
    const login = sessionStore.session?.user.login ?? "";
    return html`
      <main class="grid min-h-dvh place-items-center bg-background px-6 py-10">
        <section class="animate-login-entry w-full max-w-lg rounded-2xl border border-border bg-surface p-8 shadow-card sm:p-10">
          <div class="flex items-center gap-3">${brandMark(32)} ${wordmark("md")}</div>
          ${this.renderMode()}
          <p class="mt-8 flex flex-wrap items-center gap-1 border-t border-border pt-4 text-xs text-text-tertiary">
            Signed in with GitHub as <span class="font-medium text-text-secondary">${login}</span> ·
            <button type="button" class=${buttonClass({ variant: "link", size: "xs" })} @click=${this.signOut}>Sign out</button>
          </p>
        </section>
      </main>
    `;
  }

  private renderMode() {
    if (this.mode === "setup") {
      return html`<h1 class="mt-7 text-lg font-semibold tracking-tight text-text-primary">Protect your account</h1>
        <p class="mt-1 mb-6 text-sm text-text-secondary">
          Once a day, EasyActions asks for a 6-digit code from an authenticator app on your phone. Set it up now: it takes a minute.
        </p>
        <app-setup-steps @setup-done=${this.finish}></app-setup-steps>`;
    }
    if (this.mode === "change") return this.renderChange();
    return this.renderVerify();
  }

  private renderVerify() {
    return html`<h1 class="mt-7 text-lg font-semibold tracking-tight text-text-primary">Enter today's code</h1>
      <p class="mt-1 mb-6 text-sm text-text-secondary">
        Open your authenticator app and type the 6-digit code shown for EasyActions.
      </p>
      <div class="space-y-3">
        ${this.useRecovery
          ? html`<label class="block space-y-1.5">
              <span class="text-xs text-text-secondary">Recovery code</span>
              <input
                class=${cn(INPUT_CLASS, "h-11 font-mono tracking-wider")}
                autocomplete="off"
                spellcheck="false"
                .value=${live(this.recoveryCode)}
                @input=${(event: Event) => (this.recoveryCode = (event.target as HTMLInputElement).value)}
                @keydown=${(event: KeyboardEvent) => event.key === "Enter" && void this.verify()}
              />
            </label>`
          : html`<app-code-field
              .value=${this.code}
              .disabled=${this.busy}
              .invalid=${this.error !== ""}
              @code-change=${(event: CustomEvent<string>) => (this.code = event.detail)}
              @code-submit=${() => void this.verify()}
            ></app-code-field>`}
        ${this.error ? html`<p role="alert" class="text-xs text-signal-danger-text">${this.error}</p>` : nothing}
        <button
          type="button"
          class=${cn(buttonClass({ size: "lg" }), "w-full")}
          ?disabled=${this.busy || (this.useRecovery ? this.recoveryCode.trim().length < 10 : this.code.length !== 6)}
          aria-busy=${this.busy ? "true" : "false"}
          @click=${this.verify}
        >
          ${this.busy ? shieldLoader(16) : nothing} Verify
        </button>
        <button type="button" class=${buttonClass({ variant: "link", size: "sm" })} @click=${this.toggleRecovery}>
          ${this.useRecovery ? "Use the code from my app" : "Lost your phone? Use a recovery code"}
        </button>
      </div>`;
  }

  /** Changer d'application : d'abord le code de l'application actuelle, puis la mise en place. */
  private renderChange() {
    return html`<h1 class="mt-7 text-lg font-semibold tracking-tight text-text-primary">Change your authenticator app</h1>
      ${this.currentCode.length === 6
        ? html`<p class="mt-1 mb-6 text-sm text-text-secondary">Your current app keeps working until you confirm the new one.</p>
            <app-setup-steps
              .currentCode=${this.currentCode}
              @setup-done=${this.finish}
              @setup-rejected=${this.onChangeRejected}
            ></app-setup-steps>`
        : html`<p class="mt-1 mb-6 text-sm text-text-secondary">First, type the code from the app you use today.</p>
            <app-code-field
              label="Current 6-digit code"
              .value=${this.code}
              .invalid=${this.error !== ""}
              @code-change=${(event: CustomEvent<string>) => (this.code = event.detail)}
              @code-submit=${() => (this.currentCode = this.code)}
            ></app-code-field>
            ${this.error ? html`<p role="alert" class="mt-2 text-xs text-signal-danger-text">${this.error}</p>` : nothing}
            <button
              type="button"
              class=${cn(buttonClass({ size: "lg" }), "mt-3 w-full")}
              ?disabled=${this.code.length !== 6}
              @click=${() => (this.currentCode = this.code)}
            >
              Continue
            </button>`}`;
  }

  /** Code actuel refusé par le serveur : on le redemande, avec la raison. */
  private onChangeRejected(event: CustomEvent<string>): void {
    this.currentCode = "";
    this.code = "";
    this.error = event.detail;
  }

  private toggleRecovery(): void {
    this.useRecovery = !this.useRecovery;
    this.error = "";
  }

  private async verify(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.error = "";
    try {
      await api.twoFactor.verify(this.useRecovery ? { recoveryCode: this.recoveryCode.trim() } : { code: this.code });
      this.finish();
    } catch (err) {
      if (!(err instanceof ApiError || err instanceof TypeError)) throw err;
      this.error = errorCopy(err instanceof ApiError ? err : null).description;
      this.code = "";
      this.busy = false;
    }
  }

  private finish(): void {
    location.assign(requestedReturnTo());
  }

  /** ÉCHEC FERMÉ comme dans l'en-tête : on ne quitte la page qu'une fois la session fermée côté serveur. */
  private async signOut(): Promise<void> {
    try {
      await api.signOut();
      location.assign("/login");
    } catch (err) {
      if (!(err instanceof ApiError || err instanceof TypeError)) throw err;
      this.error = "Sign-out failed. Please try again.";
    }
  }
}
