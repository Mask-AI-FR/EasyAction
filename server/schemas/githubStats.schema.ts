import { z } from "zod";

/**
 * Réponses GitHub lues par le tableau de bord, validées à l'entrée comme celles de `github.schema.ts`
 * (qui a atteint sa limite d'exports) : un écart de forme devient une erreur `upstream`.
 */

/** Une page de `GET /repos/{owner}/{repo}/actions/runs?created=<de>..<à>`, avec le total annoncé. */
export const CreatedRunsPage = z.object({
  total_count: z.number().int().nonnegative(),
  workflow_runs: z.array(
    z.object({
      workflow_id: z.number().int().positive(),
      /** Nom du workflow ; `path` peut manquer sur un vieux GitHub Enterprise Server. */
      name: z.string().nullable().optional(),
      path: z.string().optional(),
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

/** Un commit : `author.user` est nul quand l'e-mail n'est lié à aucun compte (ou pour un robot). */
const CommitNode = z.object({
  oid: z.string().min(1),
  committedDate: z.string().min(1),
  author: z
    .object({
      email: z.string().nullable().optional(),
      user: z.object({ login: z.string().min(1) }).nullable().optional(),
    })
    .nullable(),
});

/**
 * Erreurs GraphQL (réponse HTTP 200). `path` dit ce qu'elles visent : le dépôt entier, ou une seule
 * comparaison (`["repository", "defaultBranchRef", "c3"]` : branche supprimée entre-temps).
 */
const GraphQLErrors = z.array(
  z.object({
    type: z.string().optional(),
    path: z.array(z.union([z.string(), z.number()])).optional(),
  }),
);

/** Historique de la branche par défaut depuis une date (pages de 100). `defaultBranchRef` nul : dépôt vide. */
export const CommitHistoryResult = z.object({
  data: z
    .object({
      repository: z
        .object({
          defaultBranchRef: z
            .object({
              target: z
                .object({
                  history: z
                    .object({
                      pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
                      nodes: z.array(CommitNode),
                    })
                    .optional(),
                })
                .nullable(),
            })
            .nullable(),
        })
        .nullable(),
    })
    .nullable()
    .optional(),
  errors: GraphQLErrors.optional(),
});

/** Comparaisons de la branche par défaut avec d'autres branches, en alias `c0`…`c9` (nul : branche disparue). */
export const BranchComparisonsResult = z.object({
  data: z
    .object({
      repository: z
        .object({
          defaultBranchRef: z
            .record(
              z.string(),
              z
                .object({
                  aheadBy: z.number().int().nonnegative(),
                  commits: z.object({ nodes: z.array(CommitNode) }),
                })
                .nullable(),
            )
            .nullable(),
        })
        .nullable(),
    })
    .nullable()
    .optional(),
  errors: GraphQLErrors.optional(),
});
