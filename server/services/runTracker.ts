import type { RunSummary } from "../../domain/githubTypes.ts";
import { listRecentRuns } from "../adapters/githubActions.ts";
import type { RepoPath } from "../adapters/githubApi.ts";
import type { GitHubSettings } from "../config/env.ts";

/**
 * État actuel des exécutions lancées depuis Pipliner dans un dépôt : UNE requête GitHub par dépôt et
 * par relevé (les exécutions `workflow_dispatch` créées depuis le lancement), filtrée sur les
 * identifiants suivis — au lieu d'une requête par exécution.
 */
export async function trackRuns(
  github: GitHubSettings,
  token: string,
  repo: RepoPath,
  tracked: { readonly ids: readonly number[]; readonly since: string },
): Promise<RunSummary[]> {
  const wanted = new Set(tracked.ids);
  const runs = await listRecentRuns(github, token, repo, {
    event: "workflow_dispatch",
    createdSince: tracked.since,
  });
  return runs.filter((run) => wanted.has(run.id));
}
