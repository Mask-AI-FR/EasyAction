import { html, nothing } from "lit";
import { Component, Input, TiniComponent } from "@tinijs/core";
import { sharedSheet } from "../../styles/shared-sheet.ts";
import { cn } from "../../ui/class-names.ts";

export interface TableColumn {
  readonly label: string;
  /** Colonne de nombres : alignée à droite, chiffres tabulaires. */
  readonly numeric?: boolean;
}

/** Une cellule : du texte, ou un lien vers GitHub. */
export type TableCell = string | { readonly text: string; readonly href: string };

/** Seules les adresses web s'ouvrent ; toute autre valeur reste du texte. */
const isWebAddress = (href: string): boolean => /^https?:\/\//.test(href);

/**
 * Tableau de données du tableau de bord (vue en tableau d'un graphique, listes d'échecs). Les textes
 * viennent de GitHub : Lit les insère comme texte, jamais comme HTML. Liens en encre neutre soulignée :
 * le vert de lien de la marque ferait lire « Failed » comme une réussite.
 */
@Component({ name: "app-data-table" })
export class AppDataTable extends TiniComponent {
  static override styles = [sharedSheet];

  @Input() caption = "";
  @Input({ attribute: false }) columns: readonly TableColumn[] = [];
  @Input({ attribute: false }) rows: readonly (readonly TableCell[])[] = [];
  @Input() empty = "Nothing in this period.";

  protected override render() {
    if (this.rows.length === 0) return html`<p class="py-6 text-center text-sm text-text-secondary">${this.empty}</p>`;
    return html`<div class="overflow-x-auto">
      <table class="w-full text-left text-sm">
        ${this.caption ? html`<caption class="sr-only">${this.caption}</caption>` : nothing}
        <thead class="t-eyebrow bg-surface-secondary">
          <tr>
            ${this.columns.map(
              (column) => html`<th scope="col" class=${cn("px-3 py-2 whitespace-nowrap", column.numeric ? "text-right" : "")}>${column.label}</th>`,
            )}
          </tr>
        </thead>
        <tbody>
          ${this.rows.map(
            (row) => html`<tr class="border-t border-border hover:bg-surface-hover">
              ${row.map((cell, index) => this.renderCell(cell, this.columns[index]?.numeric === true))}
            </tr>`,
          )}
        </tbody>
      </table>
    </div>`;
  }

  private renderCell(cell: TableCell, numeric: boolean) {
    const content =
      typeof cell === "string"
        ? cell
        : isWebAddress(cell.href)
          ? html`<a
              href=${cell.href}
              target="_blank"
              rel="noopener noreferrer"
              class="underline decoration-border-strong underline-offset-2 hover:decoration-current focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            >${cell.text}</a>`
          : cell.text;
    return html`<td class=${cn("px-3 py-(--row-padding-y) whitespace-nowrap text-text-primary", numeric ? "num text-right" : "")}>${content}</td>`;
  }
}
