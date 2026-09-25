import { html, nothing } from "lit";
import { Component, Input, Reactive, TiniComponent } from "@tinijs/core";
import { checkLimitChanges, LIMIT_SETTINGS, type LimitSettingKey, type LimitValues } from "../../../domain/settingsCatalog.ts";
import { api, ApiError, errorCopy } from "../../services/api-client.ts";
import { showToast } from "../../stores/toast-store.ts";
import { sharedSheet } from "../../styles/shared-sheet.ts";
import { buttonClass } from "../../ui/button-classes.ts";
import { brandSpinner } from "../../ui/brand-mark.ts";
import "./setting-field.ts";

/**
 * Les plafonds et rythmes de la page Settings. Seuls les plafonds modifiés partent au serveur, vérifiés
 * d'abord ici avec le même catalogue que lui (le serveur revérifie). Émet `limits-saved`.
 */
@Component({ name: "app-limits-form" })
export class AppLimitsForm extends TiniComponent {
  static override styles = [sharedSheet];

  @Input({ attribute: false }) limits: LimitValues | null = null;
  @Reactive() private edits: Partial<Record<LimitSettingKey, number>> = {};
  @Reactive() private busy = false;
  @Reactive() private invalid: readonly string[] = [];

  protected override render() {
    const limits = this.limits;
    if (!limits) return nothing;
    const changed = Object.keys(this.changes()).length;
    return html`<section class="rounded-lg border border-border bg-surface p-5 shadow-card" aria-labelledby="limits-heading">
      <h2 id="limits-heading" class="text-base font-semibold text-text-primary">Limits</h2>
      <p class="mt-1 text-sm text-text-secondary">They apply to the next request; open pages see them after a reload.</p>
      <div class="mt-5 grid gap-5 sm:grid-cols-2">
        ${LIMIT_SETTINGS.map(
          (setting) => html`<app-setting-field
            .setting=${setting}
            .value=${this.edits[setting.key] ?? limits[setting.key]}
            .invalid=${this.invalid.includes(setting.key)}
            @value-change=${(event: CustomEvent<number>) => (this.edits = { ...this.edits, [setting.key]: event.detail })}
          ></app-setting-field>`,
        )}
      </div>
      ${this.invalid.length > 0
        ? html`<p role="alert" class="mt-4 text-xs text-signal-danger-text">Some values are out of range. Check the highlighted fields.</p>`
        : nothing}
      <div class="mt-5 flex gap-2">
        <button
          type="button"
          class=${buttonClass()}
          ?disabled=${changed === 0 || this.busy}
          aria-busy=${this.busy ? "true" : "false"}
          @click=${this.save}
        >
          ${this.busy ? brandSpinner(16) : nothing} Save limits
        </button>
        <button type="button" class=${buttonClass({ variant: "ghost" })} ?disabled=${changed === 0 || this.busy} @click=${this.reset}>
          Cancel changes
        </button>
      </div>
    </section>`;
  }

  /** Plafonds réellement modifiés (une saisie revenue à la valeur enregistrée ne compte pas). */
  private changes(): Record<string, number> {
    const limits = this.limits;
    if (!limits) return {};
    return Object.fromEntries(Object.entries(this.edits).filter(([key, value]) => limits[key as LimitSettingKey] !== value));
  }

  private reset(): void {
    this.edits = {};
    this.invalid = [];
  }

  private async save(): Promise<void> {
    const { accepted, invalid } = checkLimitChanges(this.changes());
    this.invalid = invalid;
    if (invalid.length > 0) return;
    this.busy = true;
    try {
      const body = await api.admin.saveLimits(accepted);
      this.edits = {};
      showToast({ tone: "success", title: "Limits saved" });
      this.emitEvent("limits-saved", body);
    } catch (err) {
      if (!(err instanceof ApiError || err instanceof TypeError)) throw err;
      showToast({ tone: "error", title: "Limits not saved", description: errorCopy(err instanceof ApiError ? err : null).description });
    } finally {
      this.busy = false;
    }
  }
}
