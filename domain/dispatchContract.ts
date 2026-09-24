import type { RunSummary } from "./githubTypes.ts";

/**
 * Contrat HTTP du déclenchement de pipelines et du suivi de leurs exécutions (`POST /api/dispatches`,
 * `GET /api/repos/:owner/:repo/runs`). Séparé de `apiContract.ts` pour garder chaque module sous dix
 * symboles publics (CLAUDE.md §3.1) ; même règle de propriété unique.
 */

/** Un workflow à lancer sur une branche. `ref` : nom de branche. */
export interface DispatchTarget {
  readonly owner: string;
  readonly repo: string;
  readonly workflowId: number;
  readonly ref: string;
}

export interface DispatchRequestBody {
  readonly targets: readonly DispatchTarget[];
}

/** Refus de GitHub pour une cible, traduit en code stable (jamais son message brut). */
export type DispatchRejection =
  | "no_dispatch_trigger"
  | "missing_inputs"
  | "ref_not_found"
  | "not_found"
  | "forbidden"
  | "sso_required"
  | "unprocessable";

/**
 * Issue d'une cible, dans l'ordre de la demande :
 * - `dispatched` : GitHub a créé l'exécution (`runId` absent si GitHub ne l'a pas renvoyé) ;
 * - `rejected` : GitHub a refusé, rien n'est parti ;
 * - `not_attempted` : arrêté avant l'envoi (limite de débit, session terminée) ;
 * - `unknown` : délai dépassé ou panne pendant l'envoi — peut-être parti, à vérifier sur GitHub,
 *   jamais relancé automatiquement (un doublon déclencherait un deuxième déploiement).
 */
export type DispatchOutcome =
  | {
      readonly status: "dispatched";
      readonly target: DispatchTarget;
      readonly runId: number | null;
      readonly htmlUrl: string | null;
    }
  | { readonly status: "rejected"; readonly target: DispatchTarget; readonly code: DispatchRejection }
  | {
      readonly status: "not_attempted";
      readonly target: DispatchTarget;
      readonly code: "rate_limited" | "unauthorized";
    }
  | { readonly status: "unknown"; readonly target: DispatchTarget; readonly code: "timeout" | "upstream" };

export interface DispatchBody {
  readonly outcomes: readonly DispatchOutcome[];
}

/** `GET /api/repos/:owner/:repo/runs?ids=…&since=…` : les exécutions suivies, dans leur état actuel. */
export interface RunsBody {
  readonly runs: readonly RunSummary[];
}
