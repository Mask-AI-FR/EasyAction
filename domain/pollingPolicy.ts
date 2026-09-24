/**
 * Rythme du suivi en direct des exécutions lancées. Chaque relevé coûte une requête GitHub par dépôt
 * suivi ; le quota d'un utilisateur (5 000 requêtes/heure) est partagé avec tout le reste du tableau
 * de bord. D'où : un minimum configuré, un intervalle qui s'allonge avec le nombre de dépôts, et qui
 * double après chaque échec consécutif.
 */

/** Échecs consécutifs après lesquels un suivi s'arrête (« état inconnu », lien vers GitHub). */
export const MAX_CONSECUTIVE_FAILURES = 3;

/** Dépôts relevés au rythme du minimum ; au-delà, l'intervalle s'allonge par tranche. */
const REPOS_PER_STEP = 3;

/** L'intervalle ne dépasse jamais dix fois le minimum configuré. */
const MAX_FACTOR = 10;

export function nextPollSeconds(minSeconds: number, repoCount: number, consecutiveFailures: number): number {
  const steps = Math.max(1, Math.ceil(repoCount / REPOS_PER_STEP));
  const backoff = 2 ** Math.max(0, consecutiveFailures);
  return Math.min(minSeconds * steps * backoff, minSeconds * MAX_FACTOR);
}

export interface TrackingState {
  readonly startedAt: number;
  readonly now: number;
  readonly maxMinutes: number;
  readonly unfinished: number;
  readonly consecutiveFailures: number;
}

/** Le suivi continue tant qu'il reste des exécutions en cours, sans trop d'échecs ni dépasser la durée. */
export function keepTracking(state: TrackingState): boolean {
  return (
    state.unfinished > 0 &&
    state.consecutiveFailures < MAX_CONSECUTIVE_FAILURES &&
    state.now - state.startedAt < state.maxMinutes * 60_000
  );
}
