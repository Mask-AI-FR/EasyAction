import { html, nothing, svg } from "lit";
import { Page, Reactive, TiniComponent } from "@tinijs/core";
import { getParams, go, ROUTE_CHANGE_EVENT } from "@tinijs/router";
import {
  DASHBOARD_DAYS,
  type DashboardBody,
  type DashboardDays,
  type KpiValue,
  type RepositoryStats,
} from "../../domain/dashboardContract.ts";
import { api, ApiError, asLoadError, errorCopy } from "../services/api-client.ts";
import { formatCount, formatDuration, formatPercent } from "../services/chart-theme.ts";
import { sharedSheet } from "../styles/shared-sheet.ts";
import { cn } from "../ui/class-names.ts";
import { errorPanel } from "../components/empty-state.ts";
import type { ChartSeries } from "../components/dashboard/bar-chart.ts";
import type { TableCell } from "../components/dashboard/data-table.ts";
import type { KpiTrend } from "../components/dashboard/kpi-tile.ts";
import "../components/dashboard/bar-chart.ts";
import "../components/dashboard/chart-card.ts";
import "../components/dashboard/coverage-notice.ts";
import "../components/dashboard/data-table.ts";
import "../components/dashboard/kpi-tile.ts";
import "../components/dashboard/period-filter.ts";

/** Dépôts montrés par graphique « par dépôt » (une carte d'écran) ; la vue en tableau les montre tous. */
const TOP_REPOSITORIES = 10;
const DEFAULT_DAYS: DashboardDays = 30;
const DAY_LABEL = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });
const WHEN = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

type ResultTone = "success" | "failed" | "other";

/** Pastille de légende : un carré de la couleur de la série ET une icône, jamais la couleur seule. */
const SWATCH: Record<ResultTone, string> = {
  success: "bg-(--chart-series-in)",
  failed: "bg-(--chart-series-out)",
  other: "bg-text-tertiary",
};
const ICON: Record<ResultTone, ReturnType<typeof svg>> = {
  success: svg`<path d="M2.5 6.5l2.5 2.5 4.5-5" />`,
  failed: svg`<path d="M3 3l6 6M9 3l-6 6" />`,
  other: svg`<path d="M3 6h6" />`,
};

/** Signe typographique : « + », et le vrai moins « − ». */
const signed = (value: number, text: string): string => `${value > 0 ? "+" : value < 0 ? "−" : ""}${text}`;

/** Écart avec la période précédente, mis en forme selon la nature du chiffre. */
function deltaOf(kpi: KpiValue, kind: "count" | "rate" | "duration"): { readonly delta: string; readonly trend: KpiTrend } {
  if (kpi.current === null) return { delta: "", trend: "flat" };
  if (kpi.previous === null) return { delta: "", trend: "none" };
  const change = kpi.current - kpi.previous;
  const trend: KpiTrend = change > 0 ? "up" : change < 0 ? "down" : "flat";
  const size = Math.abs(change);
  if (kind === "rate") return { delta: signed(change, `${(size * 100).toFixed(1)} pts`), trend };
  if (kind === "duration") return { delta: signed(change, formatDuration(size)), trend };
  if (kpi.previous === 0) return { delta: signed(change, formatCount(size)), trend };
  return { delta: signed(change, `${Math.round((size / kpi.previous) * 100)}%`), trend };
}

function valueOf(kpi: KpiValue, kind: "count" | "rate" | "duration"): string {
  if (kpi.current === null) return "—";
  if (kind === "rate") return formatPercent(kpi.current);
  return kind === "duration" ? formatDuration(kpi.current) : formatCount(kpi.current);
}

function daysFromAddress(): DashboardDays {
  const asked = new URLSearchParams(location.search).get("days");
  return DASHBOARD_DAYS.find((days) => String(days) === asked) ?? DEFAULT_DAYS;
}

/** Les dépôts les mieux classés selon une mesure (sans les vides), du plus grand au plus petit. */
function topBy(repositories: readonly RepositoryStats[], measure: (repository: RepositoryStats) => number | null) {
  return repositories
    .map((repository) => ({ repository, value: measure(repository) ?? 0 }))
    .filter((entry) => entry.value > 0)
    .sort((a, b) => b.value - a.value || a.repository.name.localeCompare(b.repository.name));
}

const repositoryCell = (repository: RepositoryStats): TableCell => ({ text: repository.name, href: repository.htmlUrl });

/**
 * Le tableau de bord d'une organisation : chiffres clés comparés à la période précédente, exécutions dans
 * le temps, classements par dépôt, échecs, et ce que les chiffres couvrent. La période vit dans l'adresse
 * (`?days=`) ; changer de période garde l'affichage précédent estompé jusqu'aux nouveaux chiffres.
 */
@Page({ name: "app-page-dashboard" })
export class AppPageDashboard extends TiniComponent {
  static override styles = [sharedSheet];

  @Reactive() private org = "";
  @Reactive() private days: DashboardDays = DEFAULT_DAYS;
  @Reactive() private data: DashboardBody | null = null;
  @Reactive() private loading = true;
  /** `undefined` : pas d'échec ; `null` : le serveur n'a pas répondu. */
  @Reactive() private error: ApiError | null | undefined = undefined;

  private readonly onRouteChange = (): void => this.syncWithAddress();

  onCreate(): void {
    addEventListener(ROUTE_CHANGE_EVENT, this.onRouteChange);
    this.syncWithAddress();
  }

  onDestroy(): void {
    removeEventListener(ROUTE_CHANGE_EVENT, this.onRouteChange);
  }

  protected override render() {
    return html`<section class="space-y-5">
      <header>
        <p class="t-eyebrow">Organization</p>
        <h1 class="mt-1 truncate text-xl font-semibold tracking-tight text-text-primary">${this.org}</h1>
        <p class="mt-1 text-sm text-text-secondary">Pipelines and commits across every repository and branch.</p>
      </header>
      <app-period-filter class="block"
        .days=${this.days}
        .busy=${this.loading}
        .period=${this.data?.period ?? null}
        generatedAt=${this.data?.generatedAt ?? ""}
        @period-change=${(event: CustomEvent<DashboardDays>) => this.changePeriod(event.detail)}
        @refresh=${() => void this.load(true)}
      ></app-period-filter>
      ${this.renderBody()}
    </section>`;
  }

  private renderBody() {
    const data = this.data;
    if (!data) {
      if (this.error !== undefined) return errorPanel(this.error, () => void this.load(true));
      return html`<div class="space-y-5" aria-busy="true">
        <div class="grid grid-cols-2 gap-3 lg:grid-cols-3">
          ${[0, 1, 2, 3, 4, 5].map(() => html`<div class="skeleton-shimmer h-28 rounded-lg"></div>`)}
        </div>
        <div class="skeleton-shimmer h-80 rounded-lg"></div>
      </div>`;
    }
    if (data.coverage.repositories === 0) {
      return html`<section class="rounded-lg border border-border bg-surface shadow-card">
        <app-empty-state class="block" size="page" variant="empty" heading="No repository"
          description="The GitHub App sees no repository in this organization."></app-empty-state>
      </section>`;
    }
    return html`${this.renderRefreshFailure()}
      <div class=${cn("space-y-5 transition-opacity duration-[var(--duration-fast)]", this.loading ? "opacity-60" : "")} aria-busy=${this.loading ? "true" : "false"}>
        ${this.renderKpis(data)} ${this.renderTimeline(data)} ${this.renderByRepository(data.repositories)} ${this.renderFailures(data)}
        <app-coverage-notice class="block" .coverage=${data.coverage}></app-coverage-notice>
      </div>`;
  }

  /** ÉCHEC OUVERT pour un rafraîchissement : les chiffres précédents restent, datés, avec la raison. */
  private renderRefreshFailure() {
    if (this.error === undefined || !this.data) return nothing;
    const copy = errorCopy(this.error);
    return html`<p role="alert" class="rounded-md bg-signal-warning-soft px-3 py-2 text-xs text-signal-warning-text">
      ${copy.heading}: ${copy.description} The figures below are from ${WHEN.format(new Date(this.data.generatedAt))}.
    </p>`;
  }

  private renderKpis(data: DashboardBody) {
    const { kpis } = data;
    const versus = `vs ${DAY_LABEL.format(new Date(data.previousPeriod.from))} – ${DAY_LABEL.format(new Date(data.previousPeriod.to))}`;
    const tile = (label: string, kpi: KpiValue, kind: "count" | "rate" | "duration", upIsGood: boolean, hint: string) => {
      const { delta, trend } = deltaOf(kpi, kind);
      return html`<app-kpi-tile label=${label} value=${valueOf(kpi, kind)} delta=${delta} trend=${trend} .upIsGood=${upIsGood} hint=${hint}></app-kpi-tile>`;
    };
    return html`<div class="grid grid-cols-2 gap-3 lg:grid-cols-3">
      ${tile("People who committed", kpis.committers, "count", true, "All branches, bots excluded")}
      ${tile("Successful runs", kpis.successfulRuns, "count", true, versus)}
      ${tile("Failed runs", kpis.failedRuns, "count", false, versus)}
      ${tile("Success rate", kpis.successRate, "rate", true, "Successful ÷ (successful + failed)")}
      ${tile("Average duration", kpis.averageDurationSeconds, "duration", false, "Successful and failed runs")}
      <app-kpi-tile label="Branches" value=${formatCount(kpis.branches)} trend="flat" hint=${`In ${data.coverage.read} repositories read`}></app-kpi-tile>
    </div>`;
  }

  private renderTimeline(data: DashboardBody) {
    const weekly = data.bucket === "week";
    const labels = data.timeline.map((bucket) => DAY_LABEL.format(new Date(bucket.start)));
    const series: (ChartSeries & { readonly tone: ResultTone })[] = [
      { label: "Successful", tone: "success", values: data.timeline.map((bucket) => bucket.success) },
      { label: "Failed", tone: "failed", values: data.timeline.map((bucket) => bucket.failed) },
      { label: "Other", tone: "other", values: data.timeline.map((bucket) => bucket.other) },
    ];
    const rows = data.timeline.map((bucket, index) => [
      labels[index] ?? "",
      formatCount(bucket.success),
      formatCount(bucket.failed),
      formatCount(bucket.other),
    ]);
    return html`<app-chart-card class="block" heading="Pipeline runs" subtitle=${weekly ? "Per week, UTC (weeks start on Monday)" : "Per day, UTC"}>
      ${legendOf(series)}
      <app-bar-chart class="block" .labels=${labels} .series=${series} summary=${summaryOf("Pipeline runs", series)}></app-bar-chart>
      <app-data-table class="block"
        slot="table"
        caption="Pipeline runs"
        .columns=${[{ label: weekly ? "Week of" : "Day" }, { label: "Successful", numeric: true }, { label: "Failed", numeric: true }, { label: "Other", numeric: true }]}
        .rows=${rows}
      ></app-data-table>
    </app-chart-card>`;
  }

  private renderByRepository(repositories: readonly RepositoryStats[]) {
    const byRuns = topBy(repositories, (repository) => repository.success + repository.failed + repository.other);
    const top = byRuns.slice(0, TOP_REPOSITORIES).map((entry) => entry.repository);
    const runSeries: (ChartSeries & { readonly tone: ResultTone })[] = [
      { label: "Successful", tone: "success", values: top.map((repository) => repository.success) },
      { label: "Failed", tone: "failed", values: top.map((repository) => repository.failed) },
      { label: "Other", tone: "other", values: top.map((repository) => repository.other) },
    ];
    const rate = (repository: RepositoryStats) =>
      repository.success + repository.failed > 0 ? formatPercent(repository.success / (repository.success + repository.failed)) : "—";
    return html`<div class="grid gap-5 lg:grid-cols-2">
      <app-chart-card class="block" heading="Runs by repository" subtitle=${byRuns.length > TOP_REPOSITORIES ? `The ${TOP_REPOSITORIES} busiest; the table lists all` : ""}>
        ${legendOf(runSeries)}
        <app-bar-chart class="block" orientation="horizontal" .labels=${top.map((repository) => repository.name)} .series=${runSeries}
          summary=${summaryOf("Runs by repository", runSeries)}></app-bar-chart>
        <app-data-table class="block" slot="table" caption="Runs by repository"
          .columns=${[{ label: "Repository" }, { label: "Successful", numeric: true }, { label: "Failed", numeric: true }, { label: "Other", numeric: true }, { label: "Success rate", numeric: true }]}
          .rows=${byRuns.map(({ repository }) => [repositoryCell(repository), formatCount(repository.success), formatCount(repository.failed), formatCount(repository.other), rate(repository)])}
        ></app-data-table>
      </app-chart-card>
      ${this.rankingCard("Branches by repository", "Branches today", topBy(repositories, (repository) => repository.branches), "count")}
      ${this.rankingCard("People who committed, by repository", "People", topBy(repositories, (repository) => repository.committers), "count")}
      ${this.rankingCard("Average run duration, by repository", "Average duration", topBy(repositories, (repository) => repository.averageDurationSeconds), "duration")}
    </div>`;
  }

  /** Classement d'une seule mesure : barres horizontales (les premières), tableau (tous). */
  private rankingCard(heading: string, measure: string, ranked: ReturnType<typeof topBy>, format: "count" | "duration") {
    const top = ranked.slice(0, TOP_REPOSITORIES);
    const series: ChartSeries[] = [{ label: measure, tone: "value", values: top.map((entry) => entry.value) }];
    const shown = (value: number) => (format === "duration" ? formatDuration(value) : formatCount(value));
    return html`<app-chart-card class="block" heading=${heading} subtitle=${ranked.length > TOP_REPOSITORIES ? `The first ${TOP_REPOSITORIES}; the table lists all` : ""}>
      ${top.length === 0
        ? html`<p class="py-6 text-center text-sm text-text-secondary">Nothing in this period.</p>`
        : html`<app-bar-chart class="block" orientation="horizontal" format=${format} .labels=${top.map((entry) => entry.repository.name)} .series=${series}
            summary=${`${heading}: ${top.map((entry) => `${entry.repository.name} ${shown(entry.value)}`).join(", ")}`}></app-bar-chart>`}
      <app-data-table class="block" slot="table" caption=${heading} .columns=${[{ label: "Repository" }, { label: measure, numeric: true }]}
        .rows=${ranked.map((entry) => [repositoryCell(entry.repository), shown(entry.value)])}></app-data-table>
    </app-chart-card>`;
  }

  private renderFailures(data: DashboardBody) {
    return html`<div class="grid gap-5 lg:grid-cols-2">
      <section class="rounded-lg border border-border bg-surface p-5 shadow-card" aria-label="Top failing workflows">
        <h2 class="mb-3 text-sm font-semibold text-text-primary">Top failing workflows</h2>
        <app-data-table class="block" caption="Top failing workflows" empty="No failed run in this period."
          .columns=${[{ label: "Workflow" }, { label: "Repository" }, { label: "Failed", numeric: true }, { label: "Runs", numeric: true }, { label: "Latest" }]}
          .rows=${data.failingWorkflows.map((workflow) => [workflow.workflow, workflow.repository, formatCount(workflow.failed), formatCount(workflow.runs), { text: "Open", href: workflow.latestFailureUrl }])}
        ></app-data-table>
      </section>
      <section class="rounded-lg border border-border bg-surface p-5 shadow-card" aria-label="Recent failures">
        <h2 class="mb-3 text-sm font-semibold text-text-primary">Recent failures</h2>
        <app-data-table class="block" caption="Recent failures" empty="No failed run in this period."
          .columns=${[{ label: "When" }, { label: "Repository" }, { label: "Workflow" }, { label: "Branch" }, { label: "Result" }]}
          .rows=${data.recentFailures.map((failure) => [WHEN.format(new Date(failure.at)), failure.repository, failure.workflow, failure.branch ?? "—", { text: failure.label, href: failure.htmlUrl }])}
        ></app-data-table>
      </section>
    </div>`;
  }

  /** Relit l'organisation et la période dans l'adresse ; ignore l'événement quand on quitte la page. */
  private syncWithAddress(): void {
    const org: unknown = getParams().org;
    if (typeof org !== "string" || org === "" || !location.pathname.endsWith("/dashboard")) return;
    const days = daysFromAddress();
    if (org === this.org && days === this.days && (this.data || this.loading)) return;
    if (org !== this.org) this.data = null;
    this.org = org;
    this.days = days;
    void this.load(false);
  }

  private changePeriod(days: DashboardDays): void {
    go(`/orgs/${encodeURIComponent(this.org)}/dashboard?days=${days}`, true);
  }

  /** Les réponses d'une ancienne période ou organisation sont ignorées. */
  private async load(fresh: boolean): Promise<void> {
    const { org, days } = this;
    const current = () => org === this.org && days === this.days;
    this.loading = true;
    try {
      const data = await api.dashboard(org, days, { fresh });
      if (current()) {
        this.data = data;
        this.error = undefined;
      }
    } catch (err) {
      if (current()) this.error = asLoadError(err);
    } finally {
      if (current()) this.loading = false;
    }
  }
}

function legendOf(series: readonly (ChartSeries & { readonly tone: ResultTone })[]) {
  return html`<ul slot="legend" class="flex flex-wrap gap-x-5 gap-y-1 text-xs text-text-secondary">
    ${series.map(
      (serie) => html`<li class="inline-flex items-center gap-1.5">
        <span aria-hidden="true" class=${cn("size-2.5 rounded-[2px]", SWATCH[serie.tone])}></span>
        <svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[serie.tone]}</svg>
        ${serie.label}
        <span class="num font-medium text-text-primary">${formatCount(serie.values.reduce((sum, value) => sum + value, 0))}</span>
      </li>`,
    )}
  </ul>`;
}

/** Résumé d'un graphique pour les lecteurs d'écran : les totaux de chaque série. */
function summaryOf(title: string, series: readonly ChartSeries[]): string {
  const totals = series.map((serie) => `${formatCount(serie.values.reduce((sum, value) => sum + value, 0))} ${serie.label.toLowerCase()}`);
  return `${title}: ${totals.join(", ")}. The table view lists every value.`;
}
