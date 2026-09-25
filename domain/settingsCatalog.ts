/**
 * Catalogue des réglages du site (page Settings) : SEUL propriétaire de leur liste, de leurs bornes, de
 * leurs valeurs par défaut et de leurs libellés (CLAUDE.md §4 O). Le serveur en tire sa validation, la
 * page ses formulaires. Aucune adresse n'a de valeur par défaut (CLAUDE.md §6.3) : la connexion à
 * GitHub vient de `.env` une première fois (`bun run settings:import-env`), puis du site.
 */

/** Connexion à GitHub : les quatre se modifient ensemble. */
export const GITHUB_SETTING_KEYS = ["githubWebUrl", "githubApiUrl", "githubClientId", "githubClientSecret"] as const;
export type GitHubSettingKey = (typeof GITHUB_SETTING_KEYS)[number];

export interface GitHubFieldDefinition {
  readonly key: GitHubSettingKey;
  readonly kind: "url" | "text" | "secret";
  readonly label: string;
  readonly help: string;
}

export const GITHUB_FIELDS: readonly GitHubFieldDefinition[] = [
  { key: "githubWebUrl", kind: "url", label: "GitHub address", help: "https://github.com, or your GitHub Enterprise Server." },
  { key: "githubApiUrl", kind: "url", label: "GitHub API address", help: "Must match the GitHub address: https://api.github.com, or https://<server>/api/v3." },
  { key: "githubClientId", kind: "text", label: "GitHub App client ID", help: "On the GitHub App's settings page." },
  { key: "githubClientSecret", kind: "secret", label: "GitHub App client secret", help: "Never shown again once saved. Type it each time the connection is saved." },
];

export interface LimitDefinition {
  readonly key: string;
  readonly label: string;
  readonly help: string;
  readonly min: number;
  readonly max: number;
  readonly defaultValue: number;
}

/** Plafonds et rythmes (ce que `.env` portait jusqu'à M7). */
export const LIMIT_SETTINGS = [
  { key: "githubTimeoutMs", label: "GitHub timeout (ms)", help: "Time allowed to every GitHub call.", min: 1_000, max: 60_000, defaultValue: 10_000 },
  { key: "reposMax", label: "Repositories read per organization", help: "Above it, the list says it is truncated.", min: 1, max: 10_000, defaultValue: 1_000 },
  { key: "branchesMax", label: "Branches read per repository", help: "GitHub sends 100 per page.", min: 1, max: 1_000, defaultValue: 300 },
  { key: "activeBranchDays", label: "Days before a branch is stale", help: "Stale branches are listed after the active ones.", min: 1, max: 3_650, defaultValue: 90 },
  { key: "dispatchMaxTargets", label: "Pipelines per bulk run", help: "Every MaskAI workflow deploys: keep it small.", min: 1, max: 200, defaultValue: 50 },
  { key: "dispatchConcurrency", label: "Dispatches sent at the same time", help: "GitHub allows about 80 creations per minute.", min: 1, max: 10, defaultValue: 3 },
  { key: "runPollMinSeconds", label: "Live status: minimum seconds between checks", help: "Slower with many repositories.", min: 2, max: 300, defaultValue: 10 },
  { key: "runTrackMaxMinutes", label: "Live status: minutes runs are followed", help: "Then \"Status unknown\" with a link to GitHub.", min: 1, max: 720, defaultValue: 30 },
  { key: "statsMaxRepos", label: "Dashboard: repositories read", help: "The most recently pushed first; the others are named as not read.", min: 1, max: 500, defaultValue: 50 },
  { key: "statsMaxRunsPerRepo", label: "Dashboard: runs read per repository and period", help: "GitHub lists 1,000 at most.", min: 100, max: 1_000, defaultValue: 500 },
  { key: "statsMaxCommitsPerRepo", label: "Dashboard: commits read per repository", help: "All branches, both periods.", min: 100, max: 10_000, defaultValue: 2_000 },
  { key: "statsCacheSeconds", label: "Dashboard: seconds a result is reused", help: "0 reads GitHub again at every visit.", min: 0, max: 3_600, defaultValue: 300 },
  { key: "statsDeadlineSeconds", label: "Dashboard: seconds allowed to read GitHub", help: "Repositories not read in time are named on the dashboard.", min: 10, max: 200, defaultValue: 60 },
] as const satisfies readonly LimitDefinition[];

export type LimitSettingKey = (typeof LIMIT_SETTINGS)[number]["key"];

/** Valeurs des plafonds, toutes présentes. */
export type LimitValues = Readonly<Record<LimitSettingKey, number>>;

/** Les valeurs par défaut du catalogue. */
export function defaultLimits(): LimitValues {
  return Object.fromEntries(LIMIT_SETTINGS.map((setting) => [setting.key, setting.defaultValue])) as LimitValues;
}

/**
 * Plafonds modifiés, vérifiés contre le catalogue : `accepted` garde les bons, `invalid` nomme les clés
 * refusées (inconnues, pas entières ou hors bornes). Utilisé par le serveur et par la page Settings.
 */
export function checkLimitChanges(values: Readonly<Record<string, number>>): {
  readonly accepted: Partial<Record<LimitSettingKey, number>>;
  readonly invalid: readonly string[];
} {
  const accepted: Partial<Record<LimitSettingKey, number>> = {};
  const invalid: string[] = [];
  for (const [key, value] of Object.entries(values)) {
    const setting = LIMIT_SETTINGS.find((one) => one.key === key);
    if (!setting || !Number.isInteger(value) || value < setting.min || value > setting.max) invalid.push(key);
    else accepted[setting.key] = value;
  }
  return { accepted, invalid };
}
