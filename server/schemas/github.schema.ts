import { z } from "zod";

/**
 * Sous-ensembles des réponses GitHub que Pipliner lit, validés à l'entrée (CLAUDE.md §3.6) : tout
 * écart de forme devient une erreur `upstream` au lieu de se propager en `undefined` dans l'app.
 */

/** Réponse de `POST /login/oauth/access_token` en cas de succès (GitHub App, jetons expirants). */
export const TokenGranted = z.object({
  access_token: z.string().min(1),
  token_type: z.string(),
  /** Absent si l'app a désactivé l'expiration des jetons utilisateur. */
  expires_in: z.number().int().positive().optional(),
  /** Jeton de rafraîchissement (6 mois) et sa durée : présents quand les jetons expirent. */
  refresh_token: z.string().min(1).optional(),
  refresh_token_expires_in: z.number().int().positive().optional(),
});

/** GitHub répond HTTP 200 avec un champ `error` quand l'échange échoue (ex. `bad_verification_code`). */
export const TokenRefused = z.object({
  error: z.string().min(1),
});

/** `GET /user`. */
export const Viewer = z.object({
  id: z.number().int().positive(),
  login: z.string().min(1),
  avatar_url: z.string().min(1),
});

/** Une page de `GET /user/installations`. `account` est nul pour certaines installations d'entreprise. */
export const InstallationsPage = z.object({
  installations: z.array(
    z.object({
      id: z.number().int().positive(),
      app_slug: z.string().min(1),
      repository_selection: z.enum(["all", "selected"]),
      account: z
        .object({
          login: z.string().min(1),
          avatar_url: z.string().min(1),
          type: z.string(),
        })
        .nullable(),
    }),
  ),
});

/** Une page de `GET /user/installations/{id}/repositories`. */
export const InstallationReposPage = z.object({
  total_count: z.number().int().nonnegative(),
  repositories: z.array(
    z.object({
      id: z.number().int().positive(),
      name: z.string().min(1),
      full_name: z.string().min(1),
      owner: z.object({ login: z.string().min(1) }),
      description: z.string().nullable(),
      private: z.boolean(),
      /** Absent sur de vieux GitHub Enterprise Server : on retombe alors sur `private`. */
      visibility: z.enum(["public", "private", "internal"]).optional(),
      archived: z.boolean(),
      language: z.string().nullable(),
      default_branch: z.string().min(1),
      pushed_at: z.string().nullable(),
      html_url: z.string().min(1),
    }),
  ),
});

/**
 * Réponse GraphQL des branches d'un dépôt. GitHub répond HTTP 200 même en cas d'échec, avec un
 * tableau `errors` ; `repository` est `null` quand le dépôt est introuvable ou invisible.
 */
export const BranchesQueryResult = z.object({
  data: z
    .object({
      repository: z
        .object({
          defaultBranchRef: z.object({ name: z.string().min(1) }).nullable(),
          refs: z.object({
            /** Nombre exact de branches, même au-delà de celles lues. */
            totalCount: z.number().int().nonnegative(),
            pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
            nodes: z.array(
              z.object({
                name: z.string().min(1),
                target: z.object({ committedDate: z.string().optional() }).nullable(),
              }),
            ),
          }),
        })
        .nullable(),
    })
    .nullable()
    .optional(),
  errors: z.array(z.object({ type: z.string().optional() })).optional(),
});

/** Une page de `GET /repos/{owner}/{repo}/actions/workflows`. */
export const WorkflowsPage = z.object({
  workflows: z.array(
    z.object({
      id: z.number().int().positive(),
      name: z.string(),
      path: z.string().min(1),
      state: z.string(),
      html_url: z.string().min(1),
    }),
  ),
});

/** Une page de `GET /repos/{owner}/{repo}/actions/runs`. Statut et conclusion normalisés ensuite. */
export const RunsPage = z.object({
  workflow_runs: z.array(
    z.object({
      id: z.number().int().positive(),
      workflow_id: z.number().int().positive(),
      head_branch: z.string().nullable(),
      event: z.string(),
      status: z.string().nullable(),
      conclusion: z.string().nullable(),
      html_url: z.string().min(1),
      created_at: z.string().min(1),
      run_started_at: z.string().nullable().optional(),
      updated_at: z.string().min(1),
    }),
  ),
});

/** Réponse 200 de `POST …/dispatches` avec `return_run_details: true` (changelog GitHub 2026-02-19). */
export const DispatchAccepted = z.object({
  workflow_run_id: z.number().int().positive(),
  html_url: z.string().min(1),
});

/** Corps d'erreur de GitHub : lu pour classer un refus, jamais relayé. */
export const GitHubMessage = z.object({ message: z.string() });
