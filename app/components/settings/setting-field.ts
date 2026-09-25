import { html } from "lit";
import { live } from "lit/directives/live.js";
import { Component, Input, TiniComponent } from "@tinijs/core";
import type { LimitDefinition } from "../../../domain/settingsCatalog.ts";
import { sharedSheet } from "../../styles/shared-sheet.ts";
import { cn } from "../../ui/class-names.ts";
import { INPUT_CLASS } from "../../ui/field-classes.ts";

const NUMBER = new Intl.NumberFormat("en");

/**
 * Un plafond de la page Settings : libellé, aide, bornes et valeur par défaut viennent du catalogue
 * (`domain/settingsCatalog.ts`). Émet `value-change` (un nombre, ou `NaN` si la saisie n'en est pas un).
 */
@Component({ name: "app-setting-field" })
export class AppSettingField extends TiniComponent {
  static override styles = [sharedSheet];

  @Input({ attribute: false }) setting: LimitDefinition | null = null;
  @Input({ attribute: false }) value = 0;
  @Input({ attribute: false }) invalid = false;

  protected override render() {
    const setting = this.setting;
    if (!setting) return html``;
    return html`<label class="block space-y-1">
      <span class="text-sm font-medium text-text-primary">${setting.label}</span>
      <span class="block text-xs text-text-secondary">${setting.help}</span>
      <input
        type="number"
        inputmode="numeric"
        min=${setting.min}
        max=${setting.max}
        step="1"
        class=${cn(INPUT_CLASS, "mt-1 max-w-48 font-mono")}
        aria-invalid=${this.invalid ? "true" : "false"}
        .value=${live(String(this.value))}
        @input=${(event: Event) => this.emitEvent("value-change", Number((event.target as HTMLInputElement).value))}
      />
      <span class="block text-2xs text-text-tertiary">
        ${NUMBER.format(setting.min)} to ${NUMBER.format(setting.max)} · default ${NUMBER.format(setting.defaultValue)}
      </span>
    </label>`;
  }
}
