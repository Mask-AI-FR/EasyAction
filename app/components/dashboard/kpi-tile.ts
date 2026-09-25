import { html, nothing, svg } from "lit";
import { Component, Input, TiniComponent } from "@tinijs/core";
import { sharedSheet } from "../../styles/shared-sheet.ts";
import { cn } from "../../ui/class-names.ts";

/** Sens de l'écart avec la période précédente ; `none` : rien à comparer (pas de valeur avant, ou données incomplètes). */
export type KpiTrend = "up" | "down" | "flat" | "none";

const ARROWS: Record<Exclude<KpiTrend, "none">, ReturnType<typeof svg>> = {
  up: svg`<path d="M6 9.5v-7M3 5.5l3-3 3 3" />`,
  down: svg`<path d="M6 2.5v7M3 6.5l3 3 3-3" />`,
  flat: svg`<path d="M2.5 6h7M6.5 3l3 3-3 3" />`,
};

const TREND_WORDS: Record<Exclude<KpiTrend, "none">, string> = { up: "up", down: "down", flat: "unchanged" };

/**
 * Tuile de chiffre clé, portée de MaskAI-Frontend `components/admin/KPICard.tsx:120-183` (commit
 * 12b962f) : libellé en sourcil, valeur, écart avec la période précédente (flèche + texte signé, vert
 * ou rouge selon que la hausse est bonne ou non — jamais la couleur seule), ligne d'aide à hauteur
 * réservée. Écarts voulus : chiffres proportionnels pour la grande valeur (skill dataviz : les
 * chiffres tabulaires sont pour les colonnes), pas de compteur animé ni de courbe.
 */
@Component({ name: "app-kpi-tile" })
export class AppKpiTile extends TiniComponent {
  static override styles = [sharedSheet];

  @Input() label = "";
  @Input() value = "";
  /** Écart déjà mis en forme (« +12 % », « −3 », « +4,2 pts ») ; vide sans écart. */
  @Input() delta = "";
  @Input() trend: KpiTrend = "none";
  /** Faux quand une hausse est une mauvaise nouvelle (échecs, durée). */
  @Input({ type: Boolean }) upIsGood = true;
  @Input() hint = "";

  protected override render() {
    return html`<div class="flex h-full flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <p class="t-eyebrow truncate">${this.label}</p>
      <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span class="text-2xl leading-none font-bold tracking-tight text-text-brand">${this.value}</span>
        ${this.renderDelta()}
      </div>
      <p class="mt-auto min-h-[18px] truncate text-2xs text-text-secondary">${this.hint}</p>
    </div>`;
  }

  private renderDelta() {
    const trend = this.trend;
    if (trend === "none") {
      // Neutre : la raison (période précédente vide, ou données manquantes) est dite par la note de couverture.
      return html`<span class="text-2xs font-medium text-text-tertiary" title="No comparison with the previous period">
        —<span class="sr-only">no comparison with the previous period</span>
      </span>`;
    }
    if (!this.delta) return nothing;
    const good = trend === "flat" ? null : (trend === "up") === this.upIsGood;
    const tone = good === null ? "text-text-primary" : good ? "text-signal-success-text" : "text-signal-danger-text";
    return html`<span class=${cn("num inline-flex items-center gap-0.5 text-2xs font-medium", tone)}>
      <svg viewBox="0 0 12 12" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ARROWS[trend]}</svg>
      <span class="sr-only">${TREND_WORDS[trend]}</span>${this.delta}<span class="sr-only"> versus the previous period</span>
    </span>`;
  }
}
