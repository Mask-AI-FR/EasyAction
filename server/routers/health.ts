import { Hono } from "hono";
import type { HealthBody } from "../../domain/apiContract.ts";

const HEALTHY: HealthBody = { status: "ok", service: "pipliner" };

/** Sonde de vie, même contrat que les services MaskAI (utilisée par les healthchecks compose). */
export const healthRouter = new Hono().get("/health", (c) => c.json(HEALTHY));
