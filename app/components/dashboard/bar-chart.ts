import { html, type PropertyValues } from "lit";
import { Component, Input, TiniComponent } from "@tinijs/core";
import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  LinearScale,
  Tooltip,
  type ChartConfiguration,
  type ChartDataset,
  type ChartOptions,
  type Plugin,
} from "chart.js";
import {
  chartTheme,
  formatValue,
  onThemeChange,
  prefersReducedMotion,
  type ChartTheme,
  type SeriesTone,
  type ValueFormat,
} from "../../services/chart-theme.ts";
import { sharedSheet } from "../../styles/shared-sheet.ts";

// Seulement ce que les barres utilisent : le reste de Chart.js n'entre pas dans le bundle.
Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip);

export interface ChartSeries {
  readonly label: string;
  readonly tone: SeriesTone;
  readonly values: readonly number[];
}

/** Hauteurs (px) : colonnes à hauteur fixe ; barres horizontales à hauteur de leurs lignes. */
const COLUMN_HEIGHT = 240;
const ROW_HEIGHT = 36;
const AXIS_HEIGHT = 32;

/**
 * Graphique en barres (Chart.js), aux règles du skill dataviz : barres de 24 px au plus, bout arrondi
 * de 4 px et base carrée, 2 px de surface entre segments empilés, grille fine, info-bulle avec toutes
 * les séries du point survolé. Horizontal : la valeur (ou le total) au bout de chaque barre. La légende
 * et la vue en tableau sont données par la carte qui l'entoure (`app-chart-card`).
 */
@Component({ name: "app-bar-chart" })
export class AppBarChart extends TiniComponent {
  static override styles = [sharedSheet];

  @Input({ attribute: false }) labels: readonly string[] = [];
  @Input({ attribute: false }) series: readonly ChartSeries[] = [];
  @Input() orientation: "vertical" | "horizontal" = "vertical";
  @Input() format: ValueFormat = "count";
  /** Ce que montre le graphique, pour les lecteurs d'écran. */
  @Input() summary = "";

  private chart: Chart<"bar"> | null = null;
  private stopWatchingTheme: (() => void) | null = null;

  onFirstRender(): void {
    this.draw();
    this.stopWatchingTheme = onThemeChange(() => this.draw());
  }

  onChanges(changed: PropertyValues<this>): void {
    if (this.chart && (changed.has("labels") || changed.has("series") || changed.has("orientation") || changed.has("format"))) {
      this.draw();
    }
  }

  onDestroy(): void {
    this.stopWatchingTheme?.();
    this.chart?.destroy();
    this.chart = null;
  }

  protected override render() {
    return html`<div class="relative w-full"><canvas role="img" aria-label=${this.summary}></canvas></div>`;
  }

  /**
   * Recrée le graphique : couleurs du thème en cours, données en cours. La hauteur passe par le CSSOM
   * (`style.height`), jamais par un attribut `style` : la CSP (`default-src 'self'`) bloque les styles
   * en attribut — `styleMap` de Lit en écrit un au premier rendu, et les graphiques perdaient leur hauteur.
   */
  private draw(): void {
    const canvas = this.shadowRoot?.querySelector("canvas");
    const box = canvas?.parentElement;
    if (!canvas || !box) return;
    const height = this.orientation === "horizontal" ? AXIS_HEIGHT + this.labels.length * ROW_HEIGHT : COLUMN_HEIGHT;
    box.style.height = `${height}px`;
    this.chart?.destroy();
    this.chart = new Chart(canvas, this.configuration(chartTheme()));
  }

  private configuration(theme: ChartTheme): ChartConfiguration<"bar"> {
    const horizontal = this.orientation === "horizontal";
    const format = (value: number) => formatValue(value, this.format);
    const stacked = this.series.length > 1;
    const font = { family: theme.fontFamily, size: 12 };
    const valueAxis = {
      stacked,
      beginAtZero: true,
      grid: { color: theme.grid, drawTicks: false },
      border: { display: false },
      ticks: { color: theme.axis, font, padding: 6, precision: 0, callback: (value: number | string) => format(Number(value)) },
    };
    const categoryAxis = {
      stacked,
      grid: { display: false },
      border: { color: theme.border },
      ticks: { color: theme.axis, font, autoSkip: true, maxRotation: 0 },
    };
    return {
      type: "bar",
      data: { labels: [...this.labels], datasets: datasetsOf(this.series, theme, horizontal) },
      options: {
        indexAxis: horizontal ? "y" : "x",
        responsive: true,
        maintainAspectRatio: false,
        animation: prefersReducedMotion() ? false : { duration: 250 },
        interaction: { mode: "index", intersect: false, axis: horizontal ? "y" : "x" },
        layout: { padding: horizontal ? { right: 56 } : { top: 4 } },
        scales: horizontal ? { x: valueAxis, y: categoryAxis } : { x: categoryAxis, y: valueAxis },
        plugins: { tooltip: tooltipOf(theme, format, horizontal) },
      },
      plugins: horizontal ? [tipLabels(theme, format)] : [],
    };
  }
}

function datasetsOf(series: readonly ChartSeries[], theme: ChartTheme, horizontal: boolean): ChartDataset<"bar">[] {
  const stacked = series.length > 1;
  return series.map((serie) => ({
    label: serie.label,
    data: [...serie.values],
    backgroundColor: theme[serie.tone],
    // L'espace de 2 px entre segments : une bordure couleur de surface, côté extrémité.
    borderColor: theme.surface,
    borderWidth: stacked ? (horizontal ? { right: 2 } : { top: 2 }) : 0,
    borderRadius: 4,
    borderSkipped: "start",
    maxBarThickness: 24,
    pointStyle: "line",
  }));
}

/** Info-bulle : toutes les séries du point survolé ; la valeur d'abord, la série ensuite. */
type TooltipConfig = NonNullable<ChartOptions<"bar">["plugins"]>["tooltip"];

function tooltipOf(theme: ChartTheme, format: (value: number) => string, horizontal: boolean): TooltipConfig {
  const font = { family: theme.fontFamily, size: 12 };
  return {
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    titleColor: theme.tooltip,
    bodyColor: theme.text,
    titleFont: { ...font, weight: "bold" },
    bodyFont: font,
    usePointStyle: true,
    padding: 10,
    callbacks: { label: (item) => ` ${format((horizontal ? item.parsed.x : item.parsed.y) ?? 0)}  ${item.dataset.label ?? ""}` },
  };
}

/** La valeur au bout de chaque barre horizontale (le total pour une barre empilée), en encre de texte. */
function tipLabels(theme: ChartTheme, format: (value: number) => string): Plugin<"bar"> {
  return {
    id: "tipLabels",
    afterDatasetsDraw(chart) {
      const last = chart.getDatasetMeta(chart.data.datasets.length - 1);
      const scale = chart.scales.x;
      if (!scale) return;
      const { ctx } = chart;
      ctx.save();
      ctx.fillStyle = theme.text;
      ctx.font = `500 12px ${theme.fontFamily}`;
      ctx.textBaseline = "middle";
      last.data.forEach((bar, index) => {
        const total = chart.data.datasets.reduce((sum, dataset) => sum + Number(dataset.data[index] ?? 0), 0);
        ctx.fillText(format(total), scale.getPixelForValue(total) + 6, bar.y);
      });
      ctx.restore();
    },
  };
}
