import type { LimitSettingKey, LimitValues } from "./settingsCatalog.ts";

/**
 * Contrat de `/api/admin/settings/*` (administrateurs) et de `/api/setup/*` (installation). Le secret de
 * l'app GitHub n'en sort JAMAIS : seulement le fait qu'il est enregistré.
 */
export interface GitHubConnectionView {
  readonly webUrl: string;
  readonly apiUrl: string;
  readonly clientId: string;
  readonly clientSecretSet: boolean;
  /** Dernière modification par un administrateur (ISO 8601, UTC), ou `null` (installation, ancien import). */
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

/** `GET /api/setup` : le serveur attend-il son installation (aucune connexion à GitHub lisible) ? */
export interface SetupStatusBody {
  readonly required: boolean;
}

/** `POST /api/setup/test` : comme le test de la page Settings, mais ouvert par le code d'installation. */
export interface SetupTestRequest extends ConnectionTestRequest {
  readonly setupCode: string;
}

/** `POST /api/setup/github` : la connexion complète et le code d'installation (`bun run settings:setup-code`). */
export interface SetupConnectionRequest {
  readonly setupCode: string;
  readonly webUrl: string;
  readonly apiUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
}
