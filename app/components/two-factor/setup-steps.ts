import { html, nothing } from "lit";
import { Component, Input, Reactive, TiniComponent } from "@tinijs/core";
import type { EnrollmentBody } from "../../../domain/twoFactorContract.ts";
import { api, ApiError, asLoadError, ENROLLMENT_QR_URL, errorCopy, type LoadState } from "../../services/api-client.ts";
import { sharedSheet } from "../../styles/shared-sheet.ts";
import { buttonClass } from "../../ui/button-classes.ts";
import { brandSpinner } from "../../ui/brand-mark.ts";
import { errorPanel } from "../empty-state.ts";
import "./code-field.ts";
import "./recovery-codes.ts";

/**
 * Mise en place (ou changement) de l'application d'authentification, en trois temps : scanner le QR
 * code (ou taper la clé), donner le premier code, garder les codes de secours. Émet `setup-done`
 * quand la personne a gardé ses codes. `currentCode` : le code de l'application actuelle, exigé par
 * le serveur pour en CHANGER ; s'il est refusé, `setup-rejected` porte le message à montrer.
 */
@Component({ name: "app-setup-steps" })
export class AppSetupSteps extends TiniComponent {
  static override styles = [sharedSheet];

  @Input({ attribute: false }) currentCode = "";
  @Reactive() private enrollment: LoadState<EnrollmentBody> = { status: "loading" };
  @Reactive() private qrVersion = 0;
  @Reactive() private code = "";
  @Reactive() private busy = false;
  @Reactive() private error = "";
  @Reactive() private recoveryCodes: readonly string[] | null = null;

  onCreate(): void {
    void this.start();
  }

  protected override render() {
    if (this.recoveryCodes) {
      return html`<div class="space-y-4">
        <h2 class="text-base font-semibold text-text-primary">3. Save your recovery codes</h2>
        <app-recovery-codes .codes=${this.recoveryCodes}></app-recovery-codes>
        <button type="button" class=${buttonClass({ size: "lg" })} @click=${() => this.emitEvent("setup-done")}>
          I saved my codes — continue
        </button>
      </div>`;
    }
    const state = this.enrollment;
    if (state.status === "loading") return html`<div class="skeleton-shimmer h-64 rounded-lg" aria-busy="true"></div>`;
    if (state.status === "error") return errorPanel(state.error, () => void this.start());
    return this.renderSteps(state.data);
  }

  private renderSteps(enrollment: EnrollmentBody) {
    return html`<ol class="space-y-6">
      <li class="space-y-3">
        <h2 class="text-base font-semibold text-text-primary">1. Scan this QR code with your authenticator app</h2>
        <p class="text-sm text-text-secondary">
          Google Authenticator, Microsoft Authenticator, Authy, 2FAS, 1Password… any app that shows 6-digit codes.
        </p>
        <img
          src=${`${ENROLLMENT_QR_URL}?v=${this.qrVersion}`}
          alt="QR code that adds EasyActions to your authenticator app"
          width="176"
          height="176"
          class="size-44 rounded-md border border-border"
        />
        <p class="text-xs text-text-secondary">
          Can't scan it? Add an account by hand with this key:
          <span class="mt-1 block font-mono text-sm font-semibold tracking-wide text-text-primary">${enrollment.manualKey}</span>
        </p>
      </li>
      <li class="space-y-3">
        <h2 class="text-base font-semibold text-text-primary">2. Enter the code the app shows</h2>
        <app-code-field
          label="6-digit code for ${enrollment.issuer} (${enrollment.account})"
          .value=${this.code}
          .disabled=${this.busy}
          .invalid=${this.error !== ""}
          @code-change=${(event: CustomEvent<string>) => (this.code = event.detail)}
          @code-submit=${() => void this.confirm()}
        ></app-code-field>
        ${this.error ? html`<p role="alert" class="text-xs text-signal-danger-text">${this.error}</p>` : nothing}
        <button
          type="button"
          class=${buttonClass({ size: "lg" })}
          ?disabled=${this.code.length !== 6 || this.busy}
          aria-busy=${this.busy ? "true" : "false"}
          @click=${this.confirm}
        >
          ${this.busy ? brandSpinner(16) : nothing} Confirm
        </button>
      </li>
    </ol>`;
  }

  /**
   * Un changement refusé (code actuel faux, bloqué) remonte à la page par `setup-rejected`, qui
   * redemande le code actuel ; tout autre échec s'affiche ici, avec « Try again ».
   */
  private async start(): Promise<void> {
    this.enrollment = { status: "loading" };
    try {
      this.enrollment = { status: "ready", data: await api.twoFactor.startEnrollment(this.currentCode || undefined) };
      this.qrVersion = Date.now();
    } catch (err) {
      const error = asLoadError(err);
      if (this.currentCode && error && ["invalid_code", "code_locked", "forbidden"].includes(error.code)) {
        this.emitEvent("setup-rejected", errorCopy(error).description);
        return;
      }
      this.enrollment = { status: "error", error };
    }
  }

  private async confirm(): Promise<void> {
    if (this.code.length !== 6 || this.busy) return;
    this.busy = true;
    this.error = "";
    try {
      this.recoveryCodes = (await api.twoFactor.confirmEnrollment(this.code)).recoveryCodes;
    } catch (err) {
      if (!(err instanceof ApiError || err instanceof TypeError)) throw err;
      this.error = errorCopy(err instanceof ApiError ? err : null).description;
      this.code = "";
    } finally {
      this.busy = false;
    }
  }
}
