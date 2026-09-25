/**
 * Présentation des valeurs du tableau de bord : couleurs et police des graphiques, formats des nombres.
 *
 * Chart.js dessine sur un canvas, qui ne voit ni les classes ni les variables CSS : les couleurs sont
 * lues dans les jetons MASKAI du document, et relues à chaque changement de thème (`html.dark`,
 * `data-theme`, densité). Couleurs des séries, choisies avec le skill dataviz et son validateur (exécuté
 * le 25 septembre 2026, surfaces #ffffff et #141926) :
 * - réussies `--chart-series-in` (bleu), échouées `--chart-series-out` (orange) : pas le vert et le rouge
 *   des pastilles, la paire la plus confondue en daltonisme ; ΔE 24,7 (clair) / 26,8 (sombre) ;
 * - autres `--text-tertiary` (gris, neutre voulu : le seuil de chroma du validateur ne s'applique pas à
 *   cette case « Autres ») ; séparation daltonisme ΔE ≥ 13,1, contraste ≥ 3:1 dans les deux thèmes ;
 * - série unique (branches, personnes, durées) : `--chart-series-in`, la teinte séquentielle par défaut.
 * L'identité ne repose jamais sur la couleur seule : légende avec icône et libellé, vue en tableau.
 */
export interface ChartTheme {
  readonly success: string;
  readonly failed: string;
  readonly other: string;
  readonly value: string;
  readonly grid: string;
  readonly axis: string;
  readonly text: string;
  readonly surface: string;
  readonly border: string;
  readonly tooltip: string;
  readonly fontFamily: string;
}

export type SeriesTone = "success" | "failed" | "other" | "value";

/**
 * Couleur calculée d'un jeton (les `var()` et `color-mix()` résolus par le navigateur), puis normalisée
 * par un canvas. ÉCHEC OUVERT : une couleur que le canvas ne lit pas donne un gris moyen visible.
 */
function resolved(token: string, probe: HTMLElement, canvas: CanvasRenderingContext2D): string {
  probe.style.color = `var(${token})`;
  canvas.fillStyle = "#808080";
  canvas.fillStyle = getComputedStyle(probe).color;
  return String(canvas.fillStyle);
}

/** Les couleurs et la police du thème en cours. */
export function chartTheme(): ChartTheme {
  const probe = document.createElement("span");
  probe.hidden = true;
  document.body.append(probe);
  const canvas = document.createElement("canvas").getContext("2d");
  try {
    const color = (token: string) => (canvas ? resolved(token, probe, canvas) : "#808080");
    return {
      success: color("--chart-series-in"),
      failed: color("--chart-series-out"),
      other: color("--text-tertiary"),
      value: color("--chart-series-in"),
      grid: color("--chart-grid"),
      axis: color("--text-tertiary"),
      text: color("--text-secondary"),
      surface: color("--surface"),
      border: color("--border"),
      tooltip: color("--text-primary"),
      fontFamily: getComputedStyle(document.body).fontFamily,
    };
  } finally {
    probe.remove();
  }
}

/** Appelle `redraw` à chaque changement de thème ou de densité ; rend la fonction qui arrête d'écouter. */
export function onThemeChange(redraw: () => void): () => void {
  const observer = new MutationObserver(redraw);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme", "data-density"] });
  return () => observer.disconnect();
}

export const prefersReducedMotion = (): boolean => matchMedia("(prefers-reduced-motion: reduce)").matches;

export type ValueFormat = "count" | "duration";

const COUNT = new Intl.NumberFormat("en");
const PERCENT = new Intl.NumberFormat("en", { style: "percent", maximumFractionDigits: 1 });

export function formatCount(value: number): string {
  return COUNT.format(Math.round(value));
}

export function formatPercent(ratio: number): string {
  return PERCENT.format(ratio);
}

/** « 45s », « 3m 20s », « 1h 05m » : la forme courte de GitHub, qui tient dans une tuile et sous un axe. */
export function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}m ${String(total % 60).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

export function formatValue(value: number, format: ValueFormat): string {
  return format === "duration" ? formatDuration(value) : formatCount(value);
}
