import { html, nothing } from "lit";
import { Component, Reactive, TiniComponent } from "@tinijs/core";
import { sharedSheet } from "../styles/shared-sheet.ts";
import { brandSpinner } from "../ui/brand-mark.ts";

/**
 * Indicateur d'un changement de page lent : le routeur de TiniJS (`navIndicator: true`, app/app.ts)
 * appelle `show()` quand une page tarde plus de 500 ms, puis `hide()` quand elle est prête. Une
 * pastille en haut de l'écran, l'engrenage du logo qui tourne ; rien sinon.
 */
@Component({ name: "app-nav-indicator" })
export class AppNavIndicator extends TiniComponent {
  static override styles = [sharedSheet];

  @Reactive() private active = false;

  show(): void {
    this.active = true;
  }

  hide(): void {
    this.active = false;
  }

  protected override render() {
    if (!this.active) return nothing;
    return html`<div
      role="status"
      class="pointer-events-none fixed top-3 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-surface px-3.5 py-1.5 text-xs font-medium text-text-secondary shadow-popover animate-in fade-in"
    >
      ${brandSpinner(16, "text-primary-text")} Loading…
    </div>`;
  }
}
