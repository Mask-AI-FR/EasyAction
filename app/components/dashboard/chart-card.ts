import { html, nothing } from "lit";
import { Component, Input, Reactive, TiniComponent } from "@tinijs/core";
import { sharedSheet } from "../../styles/shared-sheet.ts";
import { cn } from "../../ui/class-names.ts";

type ChartView = "chart" | "table";

/**
 * Carte d'un graphique : titre, sous-titre, bascule « Chart / Table » (la vue en tableau est le jumeau
 * accessible de chaque graphique), légende au-dessus du graphique. Emplacements : le graphique (par
 * défaut), `legend`, `table`.
 */
@Component({ name: "app-chart-card" })
export class AppChartCard extends TiniComponent {
  static override styles = [sharedSheet];

  @Input() heading = "";
  @Input() subtitle = "";
  @Reactive() private view: ChartView = "chart";

  protected override render() {
    return html`<section class="flex h-full flex-col gap-4 rounded-lg border border-border bg-surface p-5 shadow-card" aria-label=${this.heading}>
      <header class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <h2 class="text-sm font-semibold text-text-primary">${this.heading}</h2>
          ${this.subtitle ? html`<p class="mt-0.5 text-xs text-text-secondary">${this.subtitle}</p>` : nothing}
        </div>
        <div class="inline-flex shrink-0 rounded-md border border-border-control p-0.5" role="group" aria-label="View">
          ${this.viewButton("chart", "Chart")} ${this.viewButton("table", "Table")}
        </div>
      </header>
      ${this.view === "chart" ? html`<slot name="legend"></slot><slot></slot>` : html`<slot name="table"></slot>`}
    </section>`;
  }

  private viewButton(view: ChartView, label: string) {
    const active = this.view === view;
    return html`<button
      type="button"
      aria-pressed=${active ? "true" : "false"}
      class=${cn(
        "h-7 rounded-sm px-2.5 text-xs font-medium transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
        active ? "bg-surface-secondary text-text-primary" : "text-text-secondary hover:text-text-primary",
      )}
      @click=${() => (this.view = view)}
    >
      ${label}
    </button>`;
  }
}
