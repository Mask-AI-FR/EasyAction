import { html, nothing } from "lit";
import { Component, Input, TiniComponent } from "@tinijs/core";
import type { SessionBody } from "../../../domain/apiContract.ts";
import type { OrgSummary } from "../../../domain/githubTypes.ts";
import { sharedSheet } from "../../styles/shared-sheet.ts";
import { brandMark, brandSpinner, wordmark } from "../../ui/brand-mark.ts";
import { cn } from "../../ui/class-names.ts";
import { navIcon, type NavIconName } from "../../ui/nav-icons.ts";

/**
 * Ligne de navigation : recette `navRowClass` de MaskAI-Frontend `components/sidebar/rail.tsx:25-33`
 * (commit 12b962f), la hauteur suivant la densité (`--row-padding-y`) par une classe au lieu d'un style
 * en attribut (la CSP les bloque).
 */
const ROW_CLASS =
  "relative flex w-full items-center gap-2.5 rounded-md px-2.5 py-(--row-padding-y) text-left text-sm leading-snug transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50";
const ROW_ACTIVE = "bg-surface font-medium text-text-brand shadow-cta";
const ROW_IDLE = "text-text-secondary hover:bg-surface-hover hover:text-text-primary";

interface NavLink {
  readonly href: string;
  readonly label: string;
  readonly icon: NavIconName;
}

/** L'administration ; le serveur, lui, refuse tout ce qui n'est pas administrateur. */
const ADMIN_LINKS: readonly NavLink[] = [
  { href: "/settings", label: "Settings", icon: "settings" },
  { href: "/settings/users", label: "Users", icon: "users" },
  { href: "/settings/history", label: "History", icon: "history" },
];

/** Avatar GitHub à la taille affichée (paramètre `s`), sans perdre ses autres paramètres. */
function sizedAvatar(url: string, size: number): string {
  const sized = new URL(url);
  sized.searchParams.set("s", String(size));
  return sized.toString();
}

/**
 * Contenu de la barre latérale : marque, organisation (sélecteur, tableau de bord, dépôts), toutes les
 * organisations, administration (administrateurs seulement), puis le compte et la déconnexion. Rendu
 * deux fois par la mise en page (barre fixe, tiroir) : il ne fait qu'afficher et émettre —
 * `org-change` (le login choisi), `sign-out`, et `navigate` quand un lien est suivi (le tiroir se ferme).
 */
@Component({ name: "app-side-nav" })
export class AppSideNav extends TiniComponent {
  static override styles = [sharedSheet];

  @Input({ attribute: false }) session: SessionBody | null = null;
  @Input({ attribute: false }) orgs: readonly OrgSummary[] = [];
  /** L'organisation de l'adresse, ou la dernière ouverte (gardée en mémoire par la mise en page). */
  @Input() org = "";
  /** Chemin courant, sans barre finale. */
  @Input() path = "/";
  @Input({ type: Boolean }) signingOut = false;
  @Input({ type: Boolean }) signOutFailed = false;

  protected override render() {
    return html`<div class="flex h-full min-h-0 flex-col">
      <div class="flex h-14 shrink-0 items-center px-4">
        <a href="/orgs" class="flex items-center gap-2.5 rounded-md" aria-label="EasyActions: organizations" @click=${this.followed}>
          ${brandMark(28)} ${wordmark("md")}
        </a>
      </div>
      <nav aria-label="Main navigation" class="min-h-0 flex-1 space-y-5 overflow-y-auto px-3 pt-2 pb-4">
        ${this.renderOrganization()}
        ${this.renderLinks([{ href: "/orgs", label: "All organizations", icon: "organizations" }])}
        ${this.session?.user.role === "admin"
          ? html`<section aria-labelledby="admin-title" class="space-y-1.5">
              <p id="admin-title" class="t-eyebrow px-2.5">Administration</p>
              ${this.renderLinks(ADMIN_LINKS)}
            </section>`
          : nothing}
      </nav>
      ${this.renderAccount()}
    </div>`;
  }

  /**
   * Le sélecteur d'organisation, en carte (avatar, nom, chevrons). Le vrai `<select>` natif la couvre,
   * invisible : clic, clavier et lecteurs d'écran gardent le contrôle natif ; la carte montre le focus.
   */
  private renderOrganization() {
    const org = this.org;
    if (!org) return nothing;
    const current = this.orgs.find((one) => one.login.toLowerCase() === org.toLowerCase());
    const logins = current ? this.orgs.map((one) => one.login) : [org];
    const base = `/orgs/${encodeURIComponent(org)}`;
    return html`<section class="space-y-2">
      <label
        class="relative flex items-center gap-2.5 rounded-lg border border-border bg-surface px-2.5 py-2 shadow-cta transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] focus-within:ring-[3px] focus-within:ring-ring/50 hover:border-border-strong"
      >
        ${current
          ? html`<img src=${sizedAvatar(current.avatarUrl, 56)} alt="" width="28" height="28" class="size-7 shrink-0 rounded-sm border border-border" />`
          : html`<span aria-hidden="true" class="grid size-7 shrink-0 place-items-center rounded-sm bg-primary-soft text-xs font-semibold text-primary-text">
              ${org.slice(0, 1).toUpperCase()}
            </span>`}
        <span class="min-w-0 flex-1">
          <span class="t-eyebrow block">Organization</span>
          <span class="block truncate text-sm font-semibold text-text-primary">${current?.login ?? org}</span>
        </span>
        ${navIcon("switch", "size-4 shrink-0 text-text-tertiary")}
        <select aria-label="Organization" class="absolute inset-0 size-full cursor-pointer opacity-0" @change=${this.onOrgChange}>
          ${logins.map((login) => html`<option value=${login} ?selected=${login.toLowerCase() === org.toLowerCase()}>${login}</option>`)}
        </select>
      </label>
      ${this.renderLinks([
        { href: `${base}/dashboard`, label: "Dashboard", icon: "dashboard" },
        { href: base, label: "Repositories", icon: "repositories" },
      ])}
    </section>`;
  }

  private renderLinks(links: readonly NavLink[]) {
    return html`<ul class="flex flex-col gap-0.5">
      ${links.map((link) => {
        const current = this.path === link.href;
        return html`<li>
          <a
            href=${link.href}
            aria-current=${current ? "page" : nothing}
            class=${cn(ROW_CLASS, current ? ROW_ACTIVE : ROW_IDLE)}
            @click=${this.followed}
          >
            ${current
              ? html`<span aria-hidden="true" class="absolute top-1/2 left-0 h-4 w-0.5 -translate-y-1/2 rounded-full bg-indicator"></span>`
              : nothing}
            ${navIcon(link.icon)}
            <span class="truncate">${link.label}</span>
          </a>
        </li>`;
      })}
    </ul>`;
  }

  /**
   * Pied : une carte de profil (avatar, login, rôle) qui ouvre la page Account, et le bouton de
   * déconnexion à côté — une icône nommée (`aria-label`, info-bulle), rouge au survol, l'engrenage qui
   * tourne pendant la déconnexion. Le message d'échec reste au-dessus.
   */
  private renderAccount() {
    const session = this.session;
    if (!session) return nothing;
    const onAccount = this.path === "/account";
    return html`<div class="shrink-0 space-y-2 border-t border-border p-3">
      ${this.signOutFailed
        ? html`<p role="alert" class="px-1 text-xs text-signal-danger-text">Sign-out failed. Please try again.</p>`
        : nothing}
      <div class="flex items-center gap-1 rounded-lg border border-border bg-surface p-1.5 shadow-card">
        <a
          href="/account"
          aria-current=${onAccount ? "page" : nothing}
          class=${cn(
            "flex min-w-0 flex-1 items-center gap-2.5 rounded-md p-1.5 transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-surface-hover focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
            onAccount ? "bg-surface-hover" : "",
          )}
          @click=${this.followed}
        >
          <img src=${sizedAvatar(session.user.avatarUrl, 64)} alt="" width="32" height="32" class="size-8 shrink-0 rounded-full border border-border" />
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm font-semibold text-text-primary">${session.user.login}</span>
            <span class="block truncate text-2xs text-text-secondary">${session.user.role === "admin" ? "Administrator" : "Member"}</span>
          </span>
        </a>
        <button
          type="button"
          aria-label="Sign out"
          title="Sign out"
          class="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-text-tertiary transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-signal-danger-soft hover:text-signal-danger-text focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50"
          ?disabled=${this.signingOut}
          aria-busy=${this.signingOut ? "true" : "false"}
          @click=${() => this.emitEvent("sign-out")}
        >
          ${this.signingOut ? brandSpinner(16) : navIcon("signOut")}
        </button>
      </div>
    </div>`;
  }

  private followed(): void {
    this.emitEvent("navigate");
  }

  private onOrgChange(event: Event): void {
    this.emitEvent("org-change", (event.target as HTMLSelectElement).value);
  }
}
