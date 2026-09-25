import { html, nothing } from "lit";
import { Component, Input, TiniComponent } from "@tinijs/core";
import { DASHBOARD_DAYS, type DashboardDays } from "../../../domain/dashboardContract.ts";
import { sharedSheet } from "../../styles/shared-sheet.ts";
import { buttonClass } from "../../ui/button-classes.ts";
import { cn } from "../../ui/class-names.ts";
import { brandSpinner } from "../../ui/brand-mark.ts";

const LABELS: Record<DashboardDays, string> = { 7: "7 days", 30: "30 days", 90: "90 days" };
const DAY = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });
const TIME = new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit" });

/**
 * La rangée de filtres, au-dessus de tout ce qu'elle filtre (skill dataviz) : la période d'abord, puis
 * « Refresh » et la fraîcheur des chiffres. Émet `period-change` (7, 30 ou 90) et `refresh`.
 */
@Component({ name: "app-period-filter" })
export class AppPeriodFilter extends TiniComponent {
  static override styles = [sharedSheet];

  @Input({ type: Number }) days: DashboardDays = 30;
  @Input({ type: Boolean }) busy = false;
  /** Bornes de la période affichée et heure du calcul (ISO 8601), une fois les chiffres arrivés. */
  @Input({ attribute: false }) period: { readonly from: string; readonly to: string } | null = null;
  @Input() generatedAt = "";

  protected override render() {
    return html`<div class="flex flex-wrap items-center gap-3">
      <div class="inline-flex rounded-md border border-border-control bg-surface p-0.5" role="group" aria-label="Period">
        ${DASHBOARD_DAYS.map((days) => this.periodButton(days))}
      </div>
      <button
        type="button"
        class=${buttonClass({ variant: "outline", size: "sm" })}
        ?disabled=${this.busy}
        aria-busy=${this.busy ? "true" : "false"}
        @click=${() => this.emitEvent("refresh")}
      >
        ${this.busy ? brandSpinner(16) : nothing} Refresh
      </button>
      ${this.renderFreshness()}
    </div>`;
  }

  private periodButton(days: DashboardDays) {
    const active = this.days === days;
    return html`<button
      type="button"
      aria-pressed=${active ? "true" : "false"}
      class=${cn(
        "h-8 rounded-sm px-3 text-sm font-medium transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
        active ? "bg-primary text-primary-foreground" : "text-text-secondary hover:bg-surface-hover hover:text-text-primary",
      )}
      @click=${() => !active && this.emitEvent("period-change", days)}
    >
      ${LABELS[days]}
    </button>`;
  }

  /** « Sep 19 – Sep 25 (UTC) · updated at 10:32 ». */
  private renderFreshness() {
    const period = this.period;
    if (!period || !this.generatedAt) return nothing;
    return html`<p class="text-xs text-text-secondary">
      ${DAY.format(new Date(period.from))} – ${DAY.format(new Date(period.to))} (UTC) · updated at
      ${TIME.format(new Date(this.generatedAt))}
    </p>`;
  }
}
