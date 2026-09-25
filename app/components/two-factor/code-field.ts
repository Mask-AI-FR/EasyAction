import { html } from "lit";
import { live } from "lit/directives/live.js";
import { Component, Input, TiniComponent } from "@tinijs/core";
import { sharedSheet } from "../../styles/shared-sheet.ts";
import { cn } from "../../ui/class-names.ts";
import { INPUT_CLASS } from "../../ui/field-classes.ts";

/**
 * Saisie d'un code à 6 chiffres. Clavier numérique sur téléphone (`inputmode`), remplissage proposé
 * par le système (`autocomplete="one-time-code"`), espaces et autres caractères retirés. Émet
 * `code-change` (les chiffres seuls) et `code-submit` sur Entrée.
 */
@Component({ name: "app-code-field" })
export class AppCodeField extends TiniComponent {
  static override styles = [sharedSheet];

  @Input() label = "6-digit code";
  @Input({ attribute: false }) value = "";
  @Input({ attribute: false }) disabled = false;
  @Input({ attribute: false }) invalid = false;

  protected override render() {
    return html`<label class="block space-y-1.5">
      <span class="text-xs text-text-secondary">${this.label}</span>
      <input
        class=${cn(INPUT_CLASS, "h-11 text-center font-mono text-lg tracking-[0.4em]")}
        inputmode="numeric"
        autocomplete="one-time-code"
        maxlength="7"
        spellcheck="false"
        aria-invalid=${this.invalid ? "true" : "false"}
        ?disabled=${this.disabled}
        .value=${live(this.value)}
        @input=${this.onInput}
        @keydown=${this.onKeyDown}
      />
    </label>`;
  }

  private onInput(event: Event): void {
    const digits = (event.target as HTMLInputElement).value.replace(/\D/g, "").slice(0, 6);
    this.emitEvent("code-change", digits);
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.key === "Enter") this.emitEvent("code-submit");
  }
}
