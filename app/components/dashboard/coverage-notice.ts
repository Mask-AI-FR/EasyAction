import { html, nothing } from "lit";
import { Component, Input, TiniComponent } from "@tinijs/core";
import type { DashboardCoverage } from "../../../domain/dashboardContract.ts";
import { sharedSheet } from "../../styles/shared-sheet.ts";
import { cn } from "../../ui/class-names.ts";

/** Chaque manque et sa raison, dans les mots de la page Settings (les réglages qui le règlent). */
const GAPS: readonly { readonly key: keyof DashboardCoverage; readonly text: string }[] = [
  { key: "unreadable", text: "Could not be read (GitHub refused or failed):" },
  { key: "notCollected", text: "Not read in time (Settings › Dashboard: seconds allowed to read GitHub):" },
  { key: "runsCapped", text: "Only the most recent runs were counted (Settings › Dashboard: runs read per repository):" },
  { key: "commitsCapped", text: "Only part of the commits were read (Settings › Dashboard: commits read per repository):" },
  { key: "branchesCapped", text: "Only part of the branches were read (Settings › Branches read per repository):" },
];

/**
 * Ce que les chiffres couvrent : dépôts lus, archivés (exclus), au-delà du plafond, et chaque manque
 * nommé. Le tableau de bord montre des données partielles plutôt que rien ; cette note les rend visibles
 * (exception écrite dans docs/DASHBOARD.md au principe « jamais de données partielles »).
 */
@Component({ name: "app-coverage-notice" })
export class AppCoverageNotice extends TiniComponent {
  static override styles = [sharedSheet];

  @Input({ attribute: false }) coverage: DashboardCoverage | null = null;

  protected override render() {
    const coverage = this.coverage;
    if (!coverage) return nothing;
    const gaps = GAPS.map((gap) => ({ ...gap, names: coverage[gap.key] })).filter(
      (gap): gap is typeof gap & { names: readonly string[] } => Array.isArray(gap.names) && gap.names.length > 0,
    );
    const incomplete = gaps.length > 0;
    return html`<section
      aria-label="Data coverage"
      class=${cn("rounded-lg px-4 py-3 text-xs", incomplete ? "bg-signal-warning-soft text-signal-warning-text" : "bg-surface-secondary text-text-secondary")}
    >
      <p>${this.summaryOf(coverage)}</p>
      ${incomplete
        ? html`<ul class="mt-2 space-y-1">
              ${gaps.map((gap) => html`<li>${gap.text} <span class="font-medium">${gap.names.join(", ")}</span></li>`)}
            </ul>
            <p class="mt-2">Changes versus the previous period are hidden where data is missing.</p>`
        : nothing}
    </section>`;
  }

  private summaryOf(coverage: DashboardCoverage): string {
    const parts = [`Read ${coverage.read} of ${coverage.repositories} ${coverage.repositories === 1 ? "repository" : "repositories"}`];
    if (coverage.archived > 0) parts.push(`${coverage.archived} archived, not counted`);
    if (coverage.beyondLimit > 0) {
      parts.push(`${coverage.beyondLimit} least recently pushed beyond the limit (Settings › Dashboard: repositories read)`);
    }
    return `${parts.join(" · ")}.`;
  }
}
