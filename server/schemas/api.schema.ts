import { z } from "zod";

/**
 * Entrées HTTP de Pipliner, validées à la frontière (CLAUDE.md §3.6).
 */

/** Page où revenir après connexion, par défaut. */
export const DEFAULT_RETURN_TO = "/orgs";

/**
 * Un chemin de NOTRE origine uniquement : commence par un seul `/`, sans `//`, sans barre oblique
 * inverse ni espace — sinon une redirection ouverte vers un autre site deviendrait possible.
 */
const SameOriginPath = z
  .string()
  .max(512)
  .regex(/^\/(?![/\\])[^\\\s]*$/);

export function safeReturnTo(candidate: string | undefined): string {
  const parsed = SameOriginPath.safeParse(candidate);
  return parsed.success ? parsed.data : DEFAULT_RETURN_TO;
}

/**
 * Nom d'organisation ou de compte GitHub : 1 à 39 caractères, lettres, chiffres et tirets simples, ni
 * en tête ni en fin. Validé avant de construire une adresse d'API.
 */
export const OrgLogin = z
  .string()
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/);

/** Nom de dépôt GitHub : lettres, chiffres, `.`, `_`, `-`, 100 caractères au plus, ni `.` ni `..`. */
export const RepoName = z
  .string()
  .regex(/^[A-Za-z0-9._-]{1,100}$/)
  .refine((name) => name !== "." && name !== "..");

/**
 * Nom de branche, selon les règles principales de git : pas d'espace, de caractère de contrôle, de
 * `~ ^ : ? * [ \`, de `..`, ni de `/` en tête ou en fin. Il ne sert qu'en paramètre encodé.
 */
export const BranchName = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[^\s\x00-\x1f\x7f~^:?*[\\]+$/)
  .refine((name) => !name.includes("..") && !/^\/|\/$|\.lock$/.test(name));

/** Corps de `POST /api/dispatches`. Le plafond `DISPATCH_MAX_TARGETS` est vérifié ensuite. */
export const DispatchRequest = z.object({
  targets: z
    .array(
      z.object({
        owner: OrgLogin,
        repo: RepoName,
        workflowId: z.number().int().positive(),
        ref: BranchName,
      }),
    )
    .min(1),
});

/** Paramètres de `GET /api/repos/:owner/:repo/runs` : jusqu'à 100 identifiants, et l'instant du lancement. */
export const RunsQuery = z.object({
  ids: z.string().regex(/^\d{1,20}(?:,\d{1,20}){0,99}$/),
  since: z.iso.datetime(),
});

/** Paramètres du retour de GitHub sur `/auth/callback`. */
export const CallbackQuery = z.object({
  code: z.string().min(1).max(512).optional(),
  state: z.string().min(1).max(512).optional(),
  error: z.string().max(128).optional(),
});
