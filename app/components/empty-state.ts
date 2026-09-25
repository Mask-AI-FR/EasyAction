import { html, nothing, type TemplateResult } from "lit";
import { Component, Input, Reactive, TiniComponent } from "@tinijs/core";
import { errorCopy, type ApiError } from "../services/api-client.ts";
import { buttonClass } from "../ui/button-classes.ts";
import { cn } from "../ui/class-names.ts";
import { sharedSheet } from "../styles/shared-sheet.ts";

export type EmptyStateVariant = "empty" | "no-results" | "error";
export type EmptyStateSize = "inline" | "page";

const SIZE_CLASS: Record<EmptyStateSize, string> = {
  inline: "gap-2 px-4 py-8 text-xs",
  page: "gap-3 px-6 py-16",
};

const CHIP_SIZE_CLASS: Record<EmptyStateSize, string> = {
  inline: "size-10 [&_svg]:size-5",
  page: "size-12 [&_svg]:size-6",
};

const CHIP_TONE_CLASS: Record<EmptyStateVariant, string> = {
  empty: "bg-surface-secondary text-text-tertiary",
  "no-results": "bg-surface-secondary text-text-tertiary",
  error: "bg-signal-danger-soft text-signal-danger-text",
};

/**
 * État vide, porté de MaskAI-Frontend `components/ui/EmptyState.tsx` (commit 40f75a9).
 *
 * Un état vide sans issue est un cul-de-sac — d'où l'emplacement `action`. Trois sens distincts :
 * `empty` (rien encore), `no-results` (un filtre ne renvoie rien), `error` (le chargement a échoué).
 * `heading` remplace le `title` de l'original, qui est déjà un attribut HTML global (infobulle).
 * La racine est `role="status"` : un passage de N lignes à zéro s'annonce aux lecteurs d'écran.
 */
@Component({ name: "app-empty-state" })
export class AppEmptyState extends TiniComponent {
  static override styles = [sharedSheet];

  @Input() heading = "";
  @Input() description = "";
  @Input() variant: EmptyStateVariant = "empty";
  @Input() size: EmptyStateSize = "inline";
  @Reactive() private hasIcon = false;

  protected override render() {
    return html`
      <div
        role="status"
        class=${cn(
          "animate-fade-in flex flex-col items-center justify-center text-center",
          SIZE_CLASS[this.size],
        )}
      >
        <div
          aria-hidden="true"
          ?hidden=${!this.hasIcon}
          class=${cn(
            "flex shrink-0 items-center justify-center rounded-md",
            CHIP_SIZE_CLASS[this.size],
            CHIP_TONE_CLASS[this.variant],
          )}
        >
          <slot name="icon" @slotchange=${this.onIconSlotChange}></slot>
        </div>
        <div class="space-y-1">
          <p class="text-sm font-medium text-text-primary">${this.heading}</p>
          ${this.description
            ? html`<p class="mx-auto max-w-xs text-xs text-text-secondary">
                ${this.description}
              </p>`
            : nothing}
        </div>
        <slot name="action"></slot>
      </div>
    `;
  }

  private onIconSlotChange(event: Event): void {
    const slot = event.target as HTMLSlotElement;
    this.hasIcon = slot.assignedElements().length > 0;
  }
}

/**
 * État d'erreur d'un chargement : explication, bouton « Try again » (un état vide sans issue est un
 * cul-de-sac) et, si l'organisation exige le SSO SAML, le lien d'autorisation fourni par GitHub.
 */
export function errorPanel(error: ApiError | null, onRetry: () => void): TemplateResult {
  const copy = errorCopy(error);
  const ssoUrl = error?.details.ssoUrl;
  return html`
    <section class="rounded-lg border border-border bg-surface shadow-card">
      <app-empty-state
        class="block"
        size="page"
        variant="error"
        heading=${copy.heading}
        description=${copy.description}
      >
        <div slot="action" class="flex items-center gap-2">
          ${ssoUrl
            ? html`<a
                href=${ssoUrl}
                target="_blank"
                rel="noopener noreferrer"
                class=${buttonClass({ size: "sm" })}
                >Authorize on GitHub</a
              >`
            : nothing}
          <button type="button" class=${buttonClass({ variant: "outline", size: "sm" })} @click=${onRetry}>
            Try again
          </button>
        </div>
      </app-empty-state>
    </section>
  `;
}

/**
 * Pages d'administration : un refus du serveur (403) devient « réservé aux administrateurs », pas une
 * erreur ; tout autre échec, le panneau d'erreur. Le serveur reste seul juge du rôle.
 */
export function adminOnlyPanel(error: ApiError | null, onRetry: () => void): TemplateResult {
  if (error?.code !== "forbidden") return errorPanel(error, onRetry);
  return html`
    <section class="rounded-lg border border-border bg-surface shadow-card">
      <app-empty-state
        class="block"
        size="page"
        variant="empty"
        heading="Administrators only"
        description="Ask an administrator of EasyActions to give you the admin role."
      ></app-empty-state>
    </section>
  `;
}
