import { html } from "lit";
import { Page, TiniComponent } from "@tinijs/core";
import { buttonClass } from "../ui/button-classes.ts";
import { sharedSheet } from "../styles/shared-sheet.ts";
import "../components/empty-state.ts";

/** Page 404 : aucune route connue ne correspond à l'adresse. */
@Page({ name: "app-page-not-found" })
export class AppPageNotFound extends TiniComponent {
  static override styles = [sharedSheet];

  protected override render() {
    return html`
      <main class="grid min-h-dvh place-items-center bg-background px-6">
        <app-empty-state
          class="block"
          size="page"
          variant="no-results"
          heading="Page not found"
          description="This address does not match any EasyActions screen."
        >
          <a slot="action" href="/" class=${buttonClass({ variant: "outline" })}>
            Back to start
          </a>
        </app-empty-state>
      </main>
    `;
  }
}
