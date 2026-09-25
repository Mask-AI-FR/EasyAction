import type { LimitSettingKey, LimitValues } from "./settingsCatalog.ts";

/**
 * Contrat de `/api/admin/settings/*` (administrateurs). Le secret de l'app GitHub n'en sort JAMAIS :
 * seulement le fait qu'il est enregistré.
 */
export interface GitHubConnectionView {
  readonly webUrl: string;
  readonly apiUrl: string;
  readonly clientId: string;
  readonly clientSecretSet: boolean;
  /** Dernière modification (ISO 8601, UTC), ou `null` si elle vient de l'import depuis `.env`. */
  readonly updatedAt: string | null;
}

/** `GET /api/admin/settings`. */
export interface SettingsBody {
  readonly github: GitHubConnectionView;
  readonly limits: LimitValues;
}

/** `PUT /api/admin/settings/limits` : seulement les plafonds modifiés. */
export interface LimitsUpdateRequest {
  readonly values: Partial<Record<LimitSettingKey, number>>;
}

/** `POST /api/admin/settings/github/test` : aucune donnée secrète, aucun jeton envoyé. */
export interface ConnectionTestRequest {
  readonly webUrl: string;
  readonly apiUrl: string;
}

export interface ConnectionTestBody {
  readonly ok: boolean;
  /** Raison d'un échec, en anglais, pour la page. */
  readonly message: string;
}

/**
 * `PUT /api/admin/settings/github` : les quatre ensemble, le secret toujours retapé, et un code à 6
 * chiffres actuel. Changer d'adresse ou d'identifiant déconnecte tout le monde.
 */
export interface GitHubConnectionUpdateRequest {
  readonly webUrl: string;
  readonly apiUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly code: string;
}

export interface GitHubConnectionSavedBody {
  /** Vrai : toutes les sessions ont été fermées (celle-ci comprise), il faut se reconnecter. */
  readonly signedEveryoneOut: boolean;
}
