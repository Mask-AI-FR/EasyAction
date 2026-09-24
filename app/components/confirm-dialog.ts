import { html, type PropertyValues } from "lit";
import { Component, Input, TiniComponent } from "@tinijs/core";
import { sharedSheet } from "../styles/shared-sheet.ts";

/**
 * Boîte modale portée de MaskAI-Frontend `components/ui/alert-dialog.tsx:61-84` (commit 40f75a9) :
 * `rounded-2xl border bg-popover p-6 shadow-modal`, voile `--backdrop-overlay` flouté de 2 px.
 * Écarts volontaires : `<dialog>` natif au lieu de Radix (`showModal()` apporte le piège de focus,
 * Échap et la couche supérieure) et centrage laissé au navigateur ; largeur `sm:max-w-2xl` pour
 * lister des pipelines ; `grid` seulement ouvert, sinon il écraserait le `display: none` d'un
 * `<dialog>` fermé.
 */
const DIALOG_CLASS =
  "m-auto max-h-[calc(100dvh-2rem)] w-full max-w-[calc(100%-2rem)] gap-4 overflow-y-auto rounded-2xl border border-border bg-popover p-6 text-text-primary shadow-modal animate-fade-in open:grid sm:max-w-2xl backdrop:bg-(--backdrop-overlay) backdrop:backdrop-blur-[2px]";

/**
 * Contenu dans l'emplacement par défaut, boutons dans l'emplacement `footer`. Émet `dismiss` quand
 * le navigateur ferme la boîte (Échap) ; le parent repasse alors `open` à `false`.
 */
@Component({ name: "app-confirm-dialog" })
export class AppConfirmDialog extends TiniComponent {
  static override styles = [sharedSheet];

  @Input({ attribute: false }) open = false;
  @Input() heading = "";

  onRenders(changed: PropertyValues<this>): void {
    if (!changed.has("open")) return;
    const dialog = this.renderRoot.querySelector("dialog");
    if (this.open && dialog && !dialog.open) dialog.showModal();
    if (!this.open && dialog?.open) dialog.close();
  }

  protected override render() {
    return html`
      <dialog class=${DIALOG_CLASS} aria-labelledby="heading" @close=${this.onClose}>
        <h2 id="heading" class="text-lg font-semibold">${this.heading}</h2>
        <slot></slot>
        <slot name="footer"></slot>
      </dialog>
    `;
  }

  private onClose(): void {
    if (this.open) this.emitEvent("dismiss");
  }
}
