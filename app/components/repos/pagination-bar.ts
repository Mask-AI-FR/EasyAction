import { html, nothing } from "lit";
import { Component, Input, TiniComponent } from "@tinijs/core";
import { sharedSheet } from "../../styles/shared-sheet.ts";
import { buttonClass } from "../../ui/button-classes.ts";

/** Page précédente / suivante. Émet `page-change` (détail : le numéro de la page voulue). */
@Component({ name: "app-pagination-bar" })
export class AppPaginationBar extends TiniComponent {
  static override styles = [sharedSheet];

  @Input({ type: Number }) page = 1;
  @Input({ type: Number }) pageCount = 1;

  protected override render() {
    if (this.pageCount <= 1) return nothing;
    return html`
      <nav aria-label="Pagination" class="flex items-center justify-end gap-3">
        <span class="text-xs text-text-tertiary">Page ${this.page} of ${this.pageCount}</span>
        <button
          type="button"
          class=${buttonClass({ variant: "outline", size: "sm" })}
          ?disabled=${this.page <= 1}
          @click=${() => this.emitEvent("page-change", this.page - 1)}
        >
          Previous
        </button>
        <button
          type="button"
          class=${buttonClass({ variant: "outline", size: "sm" })}
          ?disabled=${this.page >= this.pageCount}
          @click=${() => this.emitEvent("page-change", this.page + 1)}
        >
          Next
        </button>
      </nav>
    `;
  }
}
