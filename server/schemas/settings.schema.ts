import { z } from "zod";
import { isPairedApiUrl } from "../../domain/githubHosts.ts";
import { isSafeHttpUrl } from "./env.schema.ts";
import { TotpCode } from "./twoFactor.schema.ts";

/**
 * Entrées de `/api/admin/settings/*` et de `bun run settings:import-env`, validées à la frontière
 * (CLAUDE.md §3.6). Les bornes des plafonds viennent du catalogue (`checkLimitChanges`).
 */

/** Adresse https (http seulement vers la boucle locale : faux GitHub de développement), sans barre finale. */
export const SettingUrl = z
  .string()
  .trim()
  .max(200)
  .refine(isSafeHttpUrl)
  .transform((value) => value.replace(/\/+$/, ""));

const addresses = { webUrl: SettingUrl, apiUrl: SettingUrl };
/** L'adresse d'API doit être celle de l'adresse web : sinon les jetons partiraient vers un autre hôte. */
const paired = (value: { readonly webUrl: string; readonly apiUrl: string }) => isPairedApiUrl(value.webUrl, value.apiUrl);

/** Le test de connexion : la paire web/API est vérifiée ensuite, avec un message qui dit laquelle attendre. */
export const ConnectionTestRequest = z.object(addresses);

/** La connexion complète : adresses, identifiant et secret de l'app GitHub. */
export const GitHubConnectionFields = z
  .object({
    ...addresses,
    clientId: z.string().trim().min(1).max(100),
    clientSecret: z.string().trim().min(1).max(200),
  })
  .refine(paired, { path: ["apiUrl"] });

/** Enregistrement depuis la page : la connexion complète ET un code à 6 chiffres actuel (paire vérifiée ensuite). */
export const GitHubConnectionUpdateRequest = z.object({
  ...addresses,
  clientId: z.string().trim().min(1).max(100),
  clientSecret: z.string().trim().min(1).max(200),
  code: TotpCode,
});

/** Plafonds modifiés : noms et bornes vérifiés ensuite contre le catalogue. */
export const LimitsUpdateRequest = z.object({
  values: z.record(z.string().max(40), z.number().int()),
});
