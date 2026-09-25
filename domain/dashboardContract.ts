/**
 * Contrat de `GET /api/orgs/:org/dashboard?days=` : les statistiques d'une organisation. Instants ISO
 * 8601, UTC. Rien que des comptes : aucune identité de personne (login, e-mail) ne sort du serveur.
 */

/** Périodes proposées. `90` se lit par semaines ISO : les 13 dernières, la semaine en cours comprise. */
export const DASHBOARD_DAYS = [7, 30, 90] as const;
export type DashboardDays = (typeof DASHBOARD_DAYS)[number];

/**
 * Une valeur de la période et celle de la période précédente, de même durée. `previous` est nul quand il
 * n'y a rien à comparer : la valeur n'existait pas avant (aucune exécution terminée), ou la comparaison
 * tromperait (des données manquent, un plafond a été atteint). `current` est nul quand la valeur n'existe
 * pas (taux de réussite sans exécution terminée, durée sans exécution).
 */
export interface KpiValue {
  readonly current: number | null;
  readonly previous: number | null;
}

export interface DashboardKpis {
  /** Personnes différentes qui ont fait au moins un commit, sur toutes les branches (robots exclus). */
  readonly committers: KpiValue;
  readonly successfulRuns: KpiValue;
  readonly failedRuns: KpiValue;
  /** Réussies / (réussies + échouées), entre 0 et 1. */
  readonly successRate: KpiValue;
  /** Secondes, sur les exécutions réussies ou échouées ; approximative (`updated_at − run_started_at`). */
  readonly averageDurationSeconds: KpiValue;
  /** Branches aujourd'hui dans les dépôts lus (pas de période précédente : GitHub ne garde pas l'historique). */
  readonly branches: number;
}

/** Une colonne du graphique des exécutions : un jour UTC (7 et 30 jours) ou une semaine commencée le lundi (90). */
export interface RunsBucket {
  readonly start: string;
  readonly success: number;
  readonly failed: number;
  readonly other: number;
}

export interface RepositoryStats {
  readonly name: string;
  readonly htmlUrl: string;
  readonly success: number;
  readonly failed: number;
  readonly other: number;
  readonly branches: number;
  readonly committers: number;
  readonly averageDurationSeconds: number | null;
}

/** Un workflow qui échoue, et le lien vers son dernier échec. */
export interface FailingWorkflow {
  readonly repository: string;
  readonly workflow: string;
  readonly path: string;
  readonly failed: number;
  readonly runs: number;
  readonly latestFailureUrl: string;
}

export interface RecentFailure {
  readonly repository: string;
  readonly workflow: string;
  readonly branch: string | null;
  readonly event: string;
  /** « Failed », « Timed out » ou « Startup failure » (`domain/runStatus.ts`). */
  readonly label: string;
  readonly at: string;
  readonly htmlUrl: string;
}

/** Ce qui a été lu et ce qui ne l'a pas été, avec la raison : affiché sous le tableau de bord. */
export interface DashboardCoverage {
  /** Dépôts de l'installation annoncés par GitHub. */
  readonly repositories: number;
  readonly read: number;
  readonly archived: number;
  /** Au-delà des plafonds `reposMax` ou `statsMaxRepos` (les moins récemment poussés). */
  readonly beyondLimit: number;
  readonly unreadable: readonly string[];
  /** Pas lus avant la limite de temps. */
  readonly notCollected: readonly string[];
  readonly runsCapped: readonly string[];
  readonly commitsCapped: readonly string[];
  readonly branchesCapped: readonly string[];
}

export interface DashboardBody {
  readonly org: string;
  readonly days: DashboardDays;
  readonly bucket: "day" | "week";
  readonly period: { readonly from: string; readonly to: string };
  /** Même durée, juste avant : la base des comparaisons. */
  readonly previousPeriod: { readonly from: string; readonly to: string };
  readonly generatedAt: string;
  readonly kpis: DashboardKpis;
  readonly timeline: readonly RunsBucket[];
  readonly repositories: readonly RepositoryStats[];
  readonly failingWorkflows: readonly FailingWorkflow[];
  readonly recentFailures: readonly RecentFailure[];
  readonly coverage: DashboardCoverage;
}
