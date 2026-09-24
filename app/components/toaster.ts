import { html, nothing } from "lit";
import { repeat } from "lit/directives/repeat.js";
import { Component, TiniComponent } from "@tinijs/core";
import { StoreController } from "../stores/store-controller.ts";
import { dismissToast, toastStore, type Toast, type ToastTone } from "../stores/toast-store.ts";
import { sharedSheet } from "../styles/shared-sheet.ts";
import { cn } from "../ui/class-names.ts";
import { shieldLoader } from "../ui/shield-loader.ts";

/** Toasts visibles à la fois (`visibleToasts={4}` de l'original). */
const VISIBLE_TOASTS = 4;

const TOAST_CLASS =
  "pointer-events-auto flex items-start gap-3 rounded-lg border border-border bg-surface px-3.5 py-3 text-sm text-text-primary shadow-toast animate-fade-in";

const CLOSE_CLASS =
  "shrink-0 rounded-md border border-border bg-surface p-0.5 text-text-secondary hover:bg-surface-secondary hover:text-text-primary";

const ACTION_CLASS =
  "mt-2 inline-flex h-6 items-center rounded-md bg-primary px-2 text-xs font-medium text-primary-foreground btn-press";

type IconTone = Exclude<ToastTone, "loading">;

const ICON_CLASS: Record<IconTone, string> = {
  info: "text-text-secondary",
  success: "text-signal-success",
  error: "text-signal-danger",
};

/** Cercle 16 × 16 et son signe : i, coche, point d'exclamation. */
const ICON_PATH: Record<IconTone, string> = {
  info: "M8 7.5v3.5M8 5h.01M14 8A6 6 0 1 1 2 8a6 6 0 0 1 12 0Z",
  success: "M5.5 8.25l1.75 1.75 3.25-3.5M14 8A6 6 0 1 1 2 8a6 6 0 0 1 12 0Z",
  error: "M8 4.75v3.75M8 11h.01M14 8A6 6 0 1 1 2 8a6 6 0 0 1 12 0Z",
};

function toneIcon(tone: ToastTone) {
  if (tone === "loading") return shieldLoader(16, "mt-0.5 text-primary-text");
  return html`<svg viewBox="0 0 16 16" fill="none" aria-hidden="true" class=${cn("mt-0.5 size-4 shrink-0", ICON_CLASS[tone])}>
    <path d=${ICON_PATH[tone]} stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path>
  </svg>`;
}

/**
 * Pile de toasts en bas à droite, portée de MaskAI-Frontend `components/ui/sonner.tsx` (commit
 * 40f75a9) : mêmes classes de boîte, de titre, de description, de bouton d'action et de fermeture ;
 * décalage de 20 px, 4 visibles, largeur 356 px (celle de sonner). La région `aria-live` existe avant
 * le premier toast, sans quoi les lecteurs d'écran ne l'annonceraient pas.
 */
@Component({ name: "app-toaster" })
export class AppToaster extends TiniComponent {
  static override styles = [sharedSheet];

  private readonly toasts = new StoreController(this, toastStore, "toasts");

  protected override render() {
    return html`
      <section
        aria-label="Notifications"
        aria-live="polite"
        aria-relevant="additions text"
        class="pointer-events-none fixed right-5 bottom-5 z-50 flex w-[356px] max-w-[calc(100vw-2.5rem)] flex-col gap-2"
      >
        ${repeat(
          this.toasts.value.slice(-VISIBLE_TOASTS),
          (toast) => toast.id,
          (toast) => this.renderToast(toast),
        )}
      </section>
    `;
  }

  private renderToast(toast: Toast) {
    return html`
      <div class=${TOAST_CLASS}>
        ${toneIcon(toast.tone)}
        <div class="min-w-0 flex-1">
          <p class="font-medium">${toast.title}</p>
          ${toast.description
            ? html`<p class="mt-0.5 text-xs text-text-secondary">${toast.description}</p>`
            : nothing}
          ${toast.action
            ? html`<button type="button" class=${ACTION_CLASS} @click=${() => this.runAction(toast)}>
                ${toast.action.label}
              </button>`
            : nothing}
        </div>
        <button type="button" aria-label="Close notification" class=${CLOSE_CLASS} @click=${() => dismissToast(toast.id)}>
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" class="size-3.5">
            <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path>
          </svg>
        </button>
      </div>
    `;
  }

  private runAction(toast: Toast): void {
    toast.action?.run();
    dismissToast(toast.id);
  }
}
