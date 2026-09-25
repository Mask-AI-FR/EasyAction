import { html, nothing } from "lit";
import { Component, Reactive, TiniComponent } from "@tinijs/core";
import type { TwoFactorStatusBody } from "../../../domain/twoFactorContract.ts";
import { api, ApiError, asLoadError, errorCopy, type LoadState } from "../../services/api-client.ts";
import { sharedSheet } from "../../styles/shared-sheet.ts";
import { buttonClass } from "../../ui/button-classes.ts";
import { shieldLoader } from "../../ui/shield-loader.ts";
import { errorPanel } from "../empty-state.ts";
import "../confirm-dialog.ts";
import "../two-factor/code-field.ts";
import "../two-factor/recovery-codes.ts";

const DATE = new Intl.DateTimeFormat("en", { dateStyle: "medium" });

/**
 * Le code à 6 chiffres sur la page du compte : état, codes de secours restants, nouveaux codes (après
 * un code actuel) et changement d'application (page du code, mode `change`).
 */
@Component({ name: "app-two-factor-panel" })
export class AppTwoFactorPanel extends TiniComponent {
  static override styles = [sharedSheet];

  @Reactive() private state: LoadState<TwoFactorStatusBody> = { status: "loading" };
  @Reactive() private dialogOpen = false;
  @Reactive() private code = "";
  @Reactive() private busy = false;
  @Reactive() private error = "";
  @Reactive() private freshCodes: readonly string[] | null = null;

  onCreate(): void {
    void this.load();
  }

  protected override render() {
    return html`
      <section class="rounded-lg border border-border bg-surface p-5 shadow-card" aria-labelledby="two-factor-heading">
        <h2 id="two-factor-heading" class="text-base font-semibold text-text-primary">Two-step verification</h2>
        <p class="mt-1 text-sm text-text-secondary">
          Once a day, EasyActions asks for the 6-digit code from your authenticator app.
        </p>
        ${this.renderState()}
        ${this.renderDialog()}
      </section>
    `;
  }

  private renderState() {
    const state = this.state;
    if (state.status === "loading") return html`<div class="skeleton-shimmer mt-4 h-12 rounded-md" aria-busy="true"></div>`;
    if (state.status === "error") return html`<div class="mt-4">${errorPanel(state.error, () => void this.load())}</div>`;
    const { confirmedAt, recoveryCodesLeft } = state.data;
    return html`
      <p class="mt-4 text-sm text-text-primary">
        On${confirmedAt ? ` since ${DATE.format(new Date(confirmedAt))}` : ""} ·
        <span class=${recoveryCodesLeft <= 3 ? "font-medium text-signal-warning-text" : "text-text-secondary"}>
          ${recoveryCodesLeft} recovery ${recoveryCodesLeft === 1 ? "code" : "codes"} left
        </span>
      </p>
      <div class="mt-4 flex flex-wrap gap-2">
        <button type="button" class=${buttonClass({ variant: "outline", size: "sm" })} @click=${this.openDialog}>
          New recovery codes
        </button>
        <a href="/two-factor?mode=change&returnTo=%2Faccount" router-ignore class=${buttonClass({ variant: "outline", size: "sm" })}>
          Change authenticator app
        </a>
      </div>
    `;
  }

  private renderDialog() {
    return html`<app-confirm-dialog .open=${this.dialogOpen} heading="New recovery codes" @dismiss=${this.closeDialog}>
      ${this.freshCodes
        ? html`<app-recovery-codes .codes=${this.freshCodes}></app-recovery-codes>
            <div slot="footer" class="flex justify-end">
              <button type="button" class=${buttonClass({ variant: "outline" })} @click=${this.closeDialog}>Done</button>
            </div>`
        : html`<div class="space-y-3">
              <p class="text-sm text-text-secondary">Your current recovery codes stop working. Type a code from your app to continue.</p>
              <app-code-field
                .value=${this.code}
                .disabled=${this.busy}
                .invalid=${this.error !== ""}
                @code-change=${(event: CustomEvent<string>) => (this.code = event.detail)}
                @code-submit=${() => void this.regenerate()}
              ></app-code-field>
              ${this.error ? html`<p role="alert" class="text-xs text-signal-danger-text">${this.error}</p>` : nothing}
            </div>
            <div slot="footer" class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" class=${buttonClass({ variant: "outline" })} @click=${this.closeDialog}>Cancel</button>
              <button
                type="button"
                class=${buttonClass()}
                ?disabled=${this.code.length !== 6 || this.busy}
                aria-busy=${this.busy ? "true" : "false"}
                @click=${this.regenerate}
              >
                ${this.busy ? shieldLoader(16) : nothing} Create new codes
              </button>
            </div>`}
    </app-confirm-dialog>`;
  }

  private async load(): Promise<void> {
    this.state = { status: "loading" };
    try {
      this.state = { status: "ready", data: await api.twoFactor.status() };
    } catch (err) {
      this.state = { status: "error", error: asLoadError(err) };
    }
  }

  private openDialog(): void {
    this.code = "";
    this.error = "";
    this.freshCodes = null;
    this.dialogOpen = true;
  }

  private closeDialog(): void {
    if (this.busy) return;
    this.dialogOpen = false;
    // Les codes montrés une fois ne restent pas dans la page.
    this.freshCodes = null;
    void this.load();
  }

  private async regenerate(): Promise<void> {
    if (this.code.length !== 6 || this.busy) return;
    this.busy = true;
    this.error = "";
    try {
      this.freshCodes = (await api.twoFactor.regenerateRecoveryCodes(this.code)).recoveryCodes;
    } catch (err) {
      if (!(err instanceof ApiError || err instanceof TypeError)) throw err;
      this.error = errorCopy(err instanceof ApiError ? err : null).description;
      this.code = "";
    } finally {
      this.busy = false;
    }
  }
}
