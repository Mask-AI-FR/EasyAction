import { z } from "zod";
import { isSafeHttpUrl } from "./env.schema.ts";
import { TotpCode } from "./twoFactor.schema.ts";

/**
 * Entrées de `/api/admin/settings/*` et de `/api/setup/*`, validées à la frontière (CLAUDE.md §3.6).
 * La paire web/API est vérifiée ensuite, avec un message qui dit laquelle attendre ; les bornes des
 * plafonds viennent du catalogue (`checkLimitChanges`).
 */

/** Adresse https (http seulement vers la boucle locale : faux GitHub de développement), sans barre finale. */
export const SettingUrl = z
  .string()
  .trim()
  .max(200)
  .refine(isSafeHttpUrl)
  .transform((value) => value.replace(/\/+$/, ""));

const addresses = { webUrl: SettingUrl, apiUrl: SettingUrl };
const credentials = {
  clientId: z.string().trim().min(1).max(100),
  clientSecret: z.string().trim().min(1).max(200),
};
/** Code d'installation : sa forme seulement ; `checkSetupCode` dit s'il vaut. */
const SetupCode = z.string().trim().min(1).max(64);

/** Le test de connexion : aucune donnée secrète, aucun jeton envoyé. */
export const ConnectionTestRequest = z.object(addresses);

/** Enregistrement depuis la page Settings : la connexion complète ET un code à 6 chiffres actuel. */
export const GitHubConnectionUpdateRequest = z.object({ ...addresses, ...credentials, code: TotpCode });

/** Test depuis la page d'installation : ouvert par le code d'installation, sinon personne ne ferait appeler une adresse au serveur. */
export const SetupTestRequest = z.object({ ...addresses, setupCode: SetupCode });

/** Enregistrement depuis la page d'installation : la connexion complète ET le code d'installation. */
export const SetupConnectionRequest = z.object({ ...addresses, ...credentials, setupCode: SetupCode });

/** Plafonds modifiés : noms et bornes vérifiés ensuite contre le catalogue. */
export const LimitsUpdateRequest = z.object({
  values: z.record(z.string().max(40), z.number().int()),
});
