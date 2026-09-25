import { html, nothing, type PropertyValues } from "lit";
import { Component, Input, Reactive, TiniComponent } from "@tinijs/core";
import { sharedSheet } from "../../styles/shared-sheet.ts";
import { buttonClass } from "../../ui/button-classes.ts";
import { brandSpinner } from "../../ui/brand-mark.ts";
import "../confirm-dialog.ts";
import "../two-factor/code-field.ts";

/**
 * Confirmation d'une action sensible d'administration par un code à 6 chiffres actuel (le serveur le
 * vérifie : cette boîte n'est qu'un confort). Émet `code-confirm` (le code) et `dismiss`. Le parent
 * appelle l'API, puis ferme la boîte ou passe le message d'erreur dans `error`.
 */
@Component({ name: "app-code-dialog" })
export class AppCodeDialog extends TiniComponent {
  static override styles = [sharedSheet];

  @Input({ attribute: false }) open = false;
  @Input() heading = "";
  @Input() description = "";
  @Input() confirmLabel = "Confirm";
  @Input({ attribute: false }) destructive = false;
  @Input({ attribute: false }) busy = false;
  @Input({ attribute: false }) error = "";
  @Reactive() private code = "";

  onChanges(changed: PropertyValues<this>): void {
    if (changed.has("open") && this.open) this.code = "";
    if (changed.has("error") && this.error) this.code = "";
  }

  protected override render() {
    return html`<app-confirm-dialog .open=${this.open} heading=${this.heading} @dismiss=${() => this.emitEvent("dismiss")}>
      <div class="space-y-3">
        ${this.description ? html`<p class="text-sm text-text-secondary">${this.description}</p>` : nothing}
        <app-code-field
          label="Your current 6-digit code"
          .value=${this.code}
          .disabled=${this.busy}
          .invalid=${this.error !== ""}
          @code-change=${(event: CustomEvent<string>) => (this.code = event.detail)}
          @code-submit=${this.confirm}
        ></app-code-field>
        <p class="text-xs text-text-secondary">Each code works once: if you have just used one, wait for the next.</p>
        ${this.error ? html`<p role="alert" class="text-xs text-signal-danger-text">${this.error}</p>` : nothing}
      </div>
      <div slot="footer" class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" class=${buttonClass({ variant: "outline" })} ?disabled=${this.busy} @click=${() => this.emitEvent("dismiss")}>
          Cancel
        </button>
        <button
          type="button"
          class=${buttonClass({ variant: this.destructive ? "destructive" : "default" })}
          ?disabled=${this.code.length !== 6 || this.busy}
          aria-busy=${this.busy ? "true" : "false"}
          @click=${this.confirm}
        >
          ${this.busy ? brandSpinner(16) : nothing} ${this.confirmLabel}
        </button>
      </div>
    </app-confirm-dialog>`;
  }

  private confirm(): void {
    if (this.code.length === 6 && !this.busy) this.emitEvent("code-confirm", this.code);
  }
}
