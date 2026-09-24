import { html, nothing } from "lit";
import { Component, Input, TiniComponent } from "@tinijs/core";
import type { RunSignal } from "../../domain/runStatus.ts";
import { sharedSheet } from "../styles/shared-sheet.ts";
import { cn } from "../ui/class-names.ts";
import { BADGE_CLASS } from "../ui/field-classes.ts";

/**
 * Couleurs par signal, en jetons `signal-*` de MASKAI et en classes écrites en entier : Tailwind ne
 * génère que les classes qu'il lit dans le code. Le libellé accompagne toujours la couleur.
 */
const TONE_CLASS: Record<RunSignal, string> = {
  success: "bg-signal-success-soft text-signal-success-text",
  failed: "bg-signal-danger-soft text-signal-danger-text",
  // Bleu, pas la couleur de marque (verte) : « en cours » ne doit pas se lire « réussi ».
  running: "bg-shield-blue-soft text-(color:--run-text)",
  queued: "bg-signal-warning-soft text-signal-warning-text",
  attention: "bg-signal-warning-soft text-signal-warning-text",
  neutral: "bg-surface-secondary text-text-secondary",
  never: "px-0 text-text-tertiary",
};

const DOT_CLASS: Record<Exclude<RunSignal, "never">, string> = {
  success: "bg-signal-success",
  failed: "bg-signal-danger",
  running: "bg-indicator animate-loading-pulse",
  queued: "bg-signal-warning",
  attention: "bg-signal-warning",
  neutral: "bg-text-tertiary",
};

/** Pastille d'état d'une exécution (signal de `domain/runStatus.ts` + libellé). */
@Component({ name: "app-status-badge" })
export class AppStatusBadge extends TiniComponent {
  static override styles = [sharedSheet];

  @Input() signal: RunSignal = "never";
  @Input() label = "";

  protected override render() {
    const signal = this.signal;
    return html`<span class=${cn(BADGE_CLASS, TONE_CLASS[signal])}>
      ${signal === "never"
        ? nothing
        : html`<span aria-hidden="true" class=${cn("size-1.5 shrink-0 rounded-full", DOT_CLASS[signal])}></span>`}
      ${this.label}
    </span>`;
  }
}
