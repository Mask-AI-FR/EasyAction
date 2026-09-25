import type { AccountRole, AccountSessionsBody, DeleteAccountRequest, SessionsEndedBody } from "../../domain/accountContract.ts";
import type { AdminUsersBody, HistoryBody } from "../../domain/adminContract.ts";
import type { AuditAction } from "../../domain/auditActions.ts";
import type { DashboardBody, DashboardDays } from "../../domain/dashboardContract.ts";
import type { LimitSettingKey } from "../../domain/settingsCatalog.ts";
import type {
  ConnectionTestBody,
  GitHubConnectionSavedBody,
  GitHubConnectionUpdateRequest,
  SettingsBody,
  SetupConnectionRequest,
  SetupStatusBody,
  SetupTestRequest,
} from "../../domain/settingsContract.ts";
import type {
  ApiErrorBody,
  ApiErrorCode,
  BranchesBody,
  OrgsBody,
  ReposBody,
  SessionBody,
  WorkflowsBody,
} from "../../domain/apiContract.ts";
import type { DispatchBody, DispatchTarget, RunsBody } from "../../domain/dispatchContract.ts";
import type { RepoRef } from "../../domain/selection.ts";
import type {
  EnrollmentBody,
  RecoveryCodesBody,
  TwoFactorStatusBody,
  VerifyRequest,
} from "../../domain/twoFactorContract.ts";

/**
 * Accès typé à l'API d'EasyActions (nom de code : Pipliner). Même origine : le cookie de session part
 * tout seul, et le navigateur ne voit jamais le jeton GitHub — il ne parle qu'à notre serveur.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    readonly details: Omit<ApiErrorBody["detail"], "code" | "message"> = {},
    /** Texte du serveur : toujours le nôtre, jamais celui de GitHub ; montré seulement là où il explique (Settings). */
    readonly serverMessage = "",
  ) {
    super(`API ${status} ${code}`);
    this.name = "ApiError";
  }
}

/** État d'un chargement affiché par une page. `error: null` : le serveur n'a pas répondu (réseau). */
export type LoadState<T> =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly data: T }
  | { readonly status: "error"; readonly error: ApiError | null };

/** Un dépôt, désigné par son propriétaire et son nom. */
type RepoName = Pick<RepoRef, "owner" | "name">;

interface ReadOptions {
  /** Ignore la copie en mémoire (bouton « Refresh », « Try again »). */
  readonly fresh?: boolean;
}

/**
 * Durée pendant laquelle une même lecture est servie depuis la mémoire (en-tête et page lisent les
 * mêmes organisations) : un confort d'affichage, pas une limite imposée à GitHub.
 */
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { readonly at: number; readonly value: Promise<unknown> }>();

async function apiErrorFrom(response: Response): Promise<ApiError> {
  const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
  const detail = body?.detail;
  return new ApiError(
    response.status,
    detail?.code ?? "internal",
    { retryAfterSeconds: detail?.retryAfterSeconds, ssoUrl: detail?.ssoUrl },
    detail?.message ?? "",
  );
}

/**
 * La session a pris fin pendant l'utilisation (jeton expiré ou révoqué) : retour à la connexion,
 * qui ramènera ici ensuite. Rechargement complet : aucun état de l'ancienne session ne survit.
 */
function signInAgain(): void {
  const here = location.pathname + location.search;
  location.assign(`/login?error=ended&returnTo=${encodeURIComponent(here)}`);
}

/**
 * Le code à 6 chiffres du jour est à saisir (ou l'application à mettre en place) : page du code, qui
 * ramènera ici ensuite. Rechargement complet, comme pour la connexion.
 */
function secondFactorAgain(): void {
  const here = location.pathname + location.search;
  location.assign(`/two-factor?returnTo=${encodeURIComponent(here)}`);
}

/**
 * L'installation n'est pas faite (aucune connexion à GitHub côté serveur) : page d'installation,
 * rechargement complet.
 */
function setupFirst(): void {
  if (location.pathname !== "/setup") location.assign("/setup");
}

/** L'erreur d'une réponse en échec ; si c'est le code du jour ou l'installation qui manque, part vers sa page. */
async function failureOf(response: Response): Promise<ApiError> {
  const error = await apiErrorFrom(response);
  if (error.code === "second_factor_required") secondFactorAgain();
  if (error.code === "setup_required") setupFirst();
  return error;
}

/** Lecture (`GET`), ou envoi JSON (`POST`, ou `PUT` pour remplacer des réglages) quand un corps est fourni. */
async function request<T>(path: string, body?: unknown, method: "POST" | "PUT" = "POST"): Promise<T> {
  const init: RequestInit =
    body === undefined
      ? { headers: { Accept: "application/json" } }
      : {
          method,
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify(body),
        };
  const response = await fetch(path, init);
  if (response.status === 401) signInAgain();
  if (!response.ok) throw await failureOf(response);
  return (await response.json()) as T;
}

/** Lecture partagée : les appels simultanés ou récents réutilisent la même réponse ; un échec n'est pas gardé. */
function cachedRequest<T>(path: string, options: ReadOptions): Promise<T> {
  const hit = cache.get(path);
  if (!options.fresh && hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value as Promise<T>;
  const value = request<T>(path);
  cache.set(path, { at: Date.now(), value });
  value.catch(() => cache.delete(path));
  return value;
}

const repoPath = (repo: RepoName): string =>
  `/api/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;

/** La session courante, ou `null` si personne n'est connecté : un 401 est un état, pas une panne. */
async function fetchSession(): Promise<SessionBody | null> {
  const response = await fetch("/api/session", { headers: { Accept: "application/json" } });
  if (response.status === 401) return null;
  if (!response.ok) throw await failureOf(response);
  return (await response.json()) as SessionBody;
}

/**
 * Envoi dont la réponse est vide (204) : se déconnecter partout, effacer ses données. Jamais rejoué.
 * Un 401 est ici une réponse comme une autre (la session a pu finir) : l'appelant recharge la page.
 */
async function postExpectingNoContent(path: string, body: unknown): Promise<void> {
  const response = await fetch(path, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await failureOf(response);
  cache.clear();
}

/** Efface la session côté serveur (cookie + révocation du jeton GitHub). */
async function postSignOut(): Promise<void> {
  const response = await fetch("/auth/logout", { method: "POST" });
  if (!response.ok) throw await apiErrorFrom(response);
  cache.clear();
}

/** Une exécution vient de finir : la prochaine lecture des workflows du dépôt doit être fraîche. */
function forgetWorkflows(repo: RepoName): void {
  const prefix = `${repoPath(repo)}/workflows?`;
  for (const path of cache.keys()) if (path.startsWith(prefix)) cache.delete(path);
}

/**
 * Les appels de l'API. Les lectures passent par la mémoire courte ; le suivi des exécutions (`runs`)
 * et le lancement (`dispatch`) jamais : l'un doit être frais, l'autre n'est jamais rejoué.
 */
export const api = {
  session: fetchSession,
  signOut: postSignOut,
  orgs: (options: ReadOptions = {}) => cachedRequest<OrgsBody>("/api/orgs", options),
  repos: (org: string, options: ReadOptions = {}) =>
    cachedRequest<ReposBody>(`/api/orgs/${encodeURIComponent(org)}/repos`, options),
  branches: (repo: RepoName, options: ReadOptions = {}) =>
    cachedRequest<BranchesBody>(`${repoPath(repo)}/branches`, options),
  workflows: (repo: RepoName, branch: string, options: ReadOptions = {}) =>
    cachedRequest<WorkflowsBody>(`${repoPath(repo)}/workflows?branch=${encodeURIComponent(branch)}`, options),
  runs: (repo: RepoName, ids: readonly number[], since: string) =>
    request<RunsBody>(`${repoPath(repo)}/runs?${new URLSearchParams({ ids: ids.join(","), since })}`),
  dispatch: (targets: readonly DispatchTarget[]) => request<DispatchBody>("/api/dispatches", { targets }),
  /** Tableau de bord : pas de mémoire ici (le serveur garde la sienne) ; `fresh` lui fait relire GitHub. */
  dashboard: (org: string, days: DashboardDays, options: ReadOptions = {}) =>
    request<DashboardBody>(`/api/orgs/${encodeURIComponent(org)}/dashboard?days=${days}${options.fresh ? "&fresh=1" : ""}`),
  forgetWorkflows,
  /** Le compte : toujours lu frais (une session fermée ailleurs doit disparaître de la liste). */
  account: {
    sessions: () => request<AccountSessionsBody>("/api/account/sessions"),
    signOutOthers: () => request<SessionsEndedBody>("/api/account/sessions/sign-out-others", {}),
    signOutEverywhere: () => postExpectingNoContent("/api/account/sessions/sign-out-all", {}),
    deleteData: (confirmLogin: string) =>
      postExpectingNoContent("/api/account/delete", { confirmLogin } satisfies DeleteAccountRequest),
  },
  /** Le code à 6 chiffres : jamais mis en mémoire, jamais rejoué. */
  twoFactor: {
    status: () => request<TwoFactorStatusBody>("/api/account/two-factor"),
    startEnrollment: (code?: string) =>
      request<EnrollmentBody>("/api/account/two-factor/enrollment", code ? { code } : {}),
    confirmEnrollment: (code: string) =>
      request<RecoveryCodesBody>("/api/account/two-factor/enrollment/confirm", { code }),
    verify: (input: VerifyRequest) => postExpectingNoContent("/api/account/two-factor/verify", input),
    regenerateRecoveryCodes: (code: string) =>
      request<RecoveryCodesBody>("/api/account/two-factor/recovery-codes", { code }),
  },
  /** Installation (/setup) : jamais en mémoire, jamais rejouée ; test et enregistrement portent le code d'installation. */
  setup: {
    status: () => request<SetupStatusBody>("/api/setup"),
    test: (input: SetupTestRequest) => request<ConnectionTestBody>("/api/setup/test", input),
    save: (input: SetupConnectionRequest) => postExpectingNoContent("/api/setup/github", input),
  },
  /** Administration : toujours lue fraîche, jamais rejouée. Les actions sensibles portent un code. */
  admin: {
    settings: () => request<SettingsBody>("/api/admin/settings"),
    saveLimits: (values: Partial<Record<LimitSettingKey, number>>) =>
      request<SettingsBody>("/api/admin/settings/limits", { values }, "PUT"),
    testConnection: (webUrl: string, apiUrl: string) =>
      request<ConnectionTestBody>("/api/admin/settings/github/test", { webUrl, apiUrl }),
    saveConnection: (connection: GitHubConnectionUpdateRequest) =>
      request<GitHubConnectionSavedBody>("/api/admin/settings/github", connection, "PUT"),
    users: () => request<AdminUsersBody>("/api/admin/users"),
    changeRole: (id: number, role: AccountRole, code: string) =>
      postExpectingNoContent(`/api/admin/users/${id}/role`, { role, code }),
    resetTwoFactor: (id: number, code: string) => postExpectingNoContent(`/api/admin/users/${id}/reset-two-factor`, { code }),
    signOutUser: (id: number) => request<SessionsEndedBody>(`/api/admin/users/${id}/sign-out`, {}),
    deleteUser: (id: number, code: string) => postExpectingNoContent(`/api/admin/users/${id}/delete`, { code }),
    history: (before: number | null, action: AuditAction | null) => {
      const query = new URLSearchParams();
      if (before !== null) query.set("before", String(before));
      if (action) query.set("action", action);
      return request<HistoryBody>(`/api/admin/history${query.size > 0 ? `?${query}` : ""}`);
    },
  },
} as const;

/** Code QR du secret en attente (image de la même origine, jamais mise en cache). */
export const ENROLLMENT_QR_URL = "/api/account/two-factor/enrollment/qr.svg";

/** Téléchargement de ses données (lien simple : le navigateur l'enregistre sous le nom donné par le serveur). */
export const ACCOUNT_EXPORT_URL = "/api/account/export";

/** Adresse qui lance la connexion GitHub, puis revient sur `returnTo`. */
export function signInUrl(returnTo: string): string {
  return `/auth/login?returnTo=${encodeURIComponent(returnTo)}`;
}

/**
 * Échec d'un chargement, pour `LoadState` : une `ApiError`, ou `null` quand le serveur n'a pas répondu
 * (erreur réseau `TypeError`). Toute autre exception est un défaut de programmation et remonte.
 */
export function asLoadError(err: unknown): ApiError | null {
  if (err instanceof ApiError) return err;
  if (err instanceof TypeError) return null;
  throw err;
}

/** Texte à montrer pour un échec de l'API (interface en anglais). */
export function errorCopy(error: ApiError | null): { heading: string; description: string } {
  if (!error) {
    return { heading: "EasyActions is unreachable", description: "Check your connection, then try again." };
  }
  switch (error.code) {
    case "sso_required":
      return { heading: "Single sign-on required", description: "Authorize the GitHub App for this organization's SAML single sign-on on GitHub, then try again." };
    case "rate_limited": {
      const minutes = Math.max(1, Math.ceil((error.details.retryAfterSeconds ?? 60) / 60));
      return { heading: "GitHub rate limit reached", description: `GitHub asks to wait about ${minutes} min before the next request.` };
    }
    case "not_found":
      return { heading: "Organization not available", description: "The GitHub App is not installed on this organization, or you cannot see it." };
    case "forbidden":
      return { heading: "Access refused by GitHub", description: "The organization may restrict GitHub Apps, or your role does not allow this." };
    case "invalid_code":
      return { heading: "Wrong code", description: "Check that your phone shows the right time, then type the new code." };
    case "setup_required":
      return { heading: "EasyActions is not set up yet", description: "Its GitHub App connection must be entered on the setup page first." };
    case "code_locked": {
      const minutes = Math.max(1, Math.ceil((error.details.retryAfterSeconds ?? 60) / 60));
      return { heading: "Too many wrong codes", description: `Try again in about ${minutes} min.` };
    }
    default:
      return { heading: "GitHub did not answer", description: "Please try again in a moment." };
  }
}
