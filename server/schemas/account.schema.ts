import { z } from "zod";
import { OrgLogin } from "./api.schema.ts";

/**
 * Entrées de `/api/account/*`, validées à la frontière (CLAUDE.md §3.6).
 */

/** Corps de `POST /api/account/delete` : le login GitHub retapé (même forme qu'un login d'organisation). */
export const DeleteAccountRequest = z.object({
  confirmLogin: OrgLogin,
});
