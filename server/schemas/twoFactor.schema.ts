import { z } from "zod";

/**
 * Entrées de `/api/account/two-factor/*`, validées à la frontière (CLAUDE.md §3.6).
 */

/** Un code d'application d'authentification : exactement 6 chiffres (l'interface retire les espaces). */
export const TotpCode = z.string().regex(/^\d{6}$/);

/** Code de secours : 10 caractères, avec ou sans tiret ni espaces (normalisé avant hachage). */
const RecoveryCode = z.string().trim().min(10).max(20);

/** Corps de `POST …/enrollment` : le code actuel, exigé seulement pour CHANGER d'application. */
export const EnrollmentRequest = z.object({ code: TotpCode.optional() });

/** Corps de `POST …/enrollment/confirm` et `POST …/recovery-codes`. */
export const CodeRequest = z.object({ code: TotpCode });

/** Corps de `POST …/verify` : le code du jour, OU un code de secours. */
export const VerifyRequest = z.union([
  z.object({ code: TotpCode }).strict(),
  z.object({ recoveryCode: RecoveryCode }).strict(),
]);
