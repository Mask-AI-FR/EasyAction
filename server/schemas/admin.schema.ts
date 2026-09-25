import { z } from "zod";
import { TotpCode } from "./twoFactor.schema.ts";

/**
 * Entrées de `/api/admin/users/*`, validées à la frontière (CLAUDE.md §3.6).
 */

/** Action sensible : un code à 6 chiffres actuel de l'administrateur. */
export const StepUpRequest = z.object({ code: TotpCode });

export const RoleChangeRequest = z.object({
  role: z.enum(["member", "admin"]),
  code: TotpCode,
});
