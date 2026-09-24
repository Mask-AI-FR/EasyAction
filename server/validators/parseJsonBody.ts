import type { Context } from "hono";
import type { z } from "zod";
import { HttpError } from "../exceptions/HttpError.ts";

/**
 * Lit et valide un corps JSON (motif `parseJsonBody` des services Org/Billing). Un corps absent, mal
 * formé ou hors schéma répond 400 — jamais le détail de zod, qui décrirait la structure attendue.
 */
export async function parseJsonBody<T>(c: Context, schema: z.ZodType<T>): Promise<T> {
  const body: unknown = await c.req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new HttpError(400, "bad_request", "Invalid request body");
  return parsed.data;
}
