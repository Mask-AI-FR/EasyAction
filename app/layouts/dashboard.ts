import { html } from "lit";
import { Layout, Reactive, TiniComponent } from "@tinijs/core";
import { getParams, go, ROUTE_CHANGE_EVENT, type OnBeforeEnter } from "@tinijs/router";
import { defaultOrgOf } from "../../domain/defaultOrg.ts";
import type { OrgSummary } from "../../domain/githubTypes.ts";
import { api, ApiError } from "../services/api-client.ts";
import { rememberedOrg, rememberOrg } from "../stores/last-org.ts";
import { ensureSession, forgetSession, sessionStore } from "../stores/session-store.ts";
import { StoreController } from "../stores/store-controller.ts";
import { sharedSheet } from "../styles/shared-sheet.ts";
import { brandMark, wordmark } from "../ui/brand-mark.ts";
import { buttonClass } from "../ui/button-classes.ts";
import { cn } from "../ui/class-names.ts";
import { navIcon } from "../ui/nav-icons.ts";
import "../components/navigation/side-nav.ts";

function currentOrgParam(): string {
  const org: unknown = getParams().org;
  return typeof org === "string" ? org : "";
}

/** Chemin courant sans barre finale : `/settings/` et `/settings` sont la même page. */
function currentPath(): string {
  return location.pathname.replace(/\/+$/, "") || "/";
}

/** À partir de cette largeur (`lg` de Tailwind), la barre latérale est fixe ; en dessous, un tiroir. */
const DESKTOP = "(min-width: 1024px)";

/** Tiroir des petits écrans : `<dialog>` natif (piège de focus, Échap, premier plan), collé à gauche. */
const DRAWER_CLASS =
  "m-0 h-dvh max-h-dvh w-[264px] max-w-[88%] border-0 border-r border-border bg-surface-secondary p-0 shadow-modal backdrop:bg-(--backdrop-overlay) open:animate-in open:slide-in-from-left";

/**
 * Coque des pages connectées, portée de MaskAI-Frontend `components/Sidebar.tsx` (commit 12b962f) :
 * barre latérale à gauche (fixe à partir de 1024 px, tiroir en dessous) et page à droite. Le document
 * défile, pas un conteneur intérieur : les éléments collants des pages gardent leur repère. Le routeur
 * de TiniJS place la page dans le `<slot>` et garde cette mise en page d'une page à l'autre.
 */
@Layout({ name: "app-layout-dashboard" })
export class AppLayoutDashboard extends TiniComponent implements OnBeforeEnter {
  static override styles = [sharedSheet];

  private readonly session = new StoreController(this, sessionStore, "session");
  private readonly desktop = matchMedia(DESKTOP);
  @Reactive() private orgs: readonly OrgSummary[] = [];
  /**
   * L'organisation affichée : celle de l'adresse ; sinon la dernière ouverte dans ce navigateur, ou la
   * première de la liste (`defaultOrgOf`). Toujours choisie dès que la liste est connue.
   */
  @Reactive() private org = "";
  @Reactive() private path = currentPath();
  @Reactive() private signingOut = false;
  @Reactive() private signOutFailed = false;

  private readonly onRouteChange = (): void => {
    this.followAddress();
    this.closeDrawer();
  };

  /** Le tiroir n'a plus lieu d'être quand la fenêtre s'élargit : sinon, une modale invisible resterait ouverte. */
  private readonly onWidthChange = (): void => {
    if (this.desktop.matches) this.closeDrawer();
  };

  /**
   * ÉCHEC FERMÉ : pas de tableau de bord sans session vérifiée ni code du jour. Sans session →
   * connexion ; code du jour pas saisi (ou application pas mise en place) → page du code ; puis retour
   * ici. Si la vérification elle-même échoue → connexion avec un message. N'est appelée que lorsque la
   * mise en page change ; une expiration en cours de route arrive par les 401 et 403 de l'API.
   */
  async onBeforeEnter(): Promise<string | undefined> {
    const here = encodeURIComponent(location.pathname + location.search);
    try {
      const session = await ensureSession();
      if (!session) return `/login?returnTo=${here}`;
      return session.secondFactor === "verified" ? undefined : `/two-factor?returnTo=${here}`;
    } catch (err) {
      if (err instanceof ApiError || err instanceof TypeError) return "/login?error=unavailable";
      throw err;
    }
  }

  onCreate(): void {
    addEventListener(ROUTE_CHANGE_EVENT, this.onRouteChange);
    this.desktop.addEventListener("change", this.onWidthChange);
    this.followAddress();
    this.org ||= rememberedOrg() ?? "";
    void this.loadOrgs();
  }

  onDestroy(): void {
    removeEventListener(ROUTE_CHANGE_EVENT, this.onRouteChange);
    this.desktop.removeEventListener("change", this.onWidthChange);
  }

  protected override render() {
    return html`
      <button
        type="button"
        class="sr-only rounded-md bg-surface px-3 py-2 text-sm font-medium text-text-primary shadow-card focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50"
        @click=${this.skipToContent}
      >
        Skip to content
      </button>
      <div class="flex min-h-dvh bg-background">
        <aside class="sticky top-0 hidden h-dvh w-[264px] shrink-0 border-r border-border bg-surface-secondary lg:block">
          ${this.renderNav()}
        </aside>
        <div class="flex min-w-0 flex-1 flex-col">
          <header class="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-border bg-surface px-4 lg:hidden">
            <button
              type="button"
              class=${buttonClass({ variant: "ghost", size: "icon" })}
              aria-label="Open navigation"
              aria-haspopup="dialog"
              @click=${this.openDrawer}
            >
              ${navIcon("menu", "size-5")}
            </button>
            <a href="/orgs" class="flex items-center gap-2" aria-label="EasyActions: organizations">${brandMark(24)} ${wordmark("md")}</a>
          </header>
          <main id="content" tabindex="-1" class="w-full flex-1 px-6 py-8 outline-none lg:px-10">
            <div class="mx-auto w-full max-w-6xl"><slot></slot></div>
          </main>
        </div>
      </div>
      <dialog class=${DRAWER_CLASS} aria-label="Navigation" @click=${this.onDrawerClick}>
        <div class="relative h-full">
          <button
            type="button"
            class=${cn(buttonClass({ variant: "ghost", size: "icon-sm" }), "absolute top-3 right-3 z-[1]")}
            aria-label="Close navigation"
            @click=${this.closeDrawer}
          >
            ${navIcon("close")}
          </button>
          ${this.renderNav()}
        </div>
      </dialog>
    `;
  }

  /** Le même contenu dans la barre fixe et dans le tiroir. */
  private renderNav() {
    return html`<app-side-nav
      class="block h-full"
      .session=${this.session.value}
      .orgs=${this.orgs}
      org=${this.org}
      path=${this.path}
      .signingOut=${this.signingOut}
      .signOutFailed=${this.signOutFailed}
      @org-change=${(event: CustomEvent<string>) => this.onOrgChange(event.detail)}
      @sign-out=${() => void this.onSignOut()}
      @navigate=${this.closeDrawer}
    ></app-side-nav>`;
  }

  private drawer(): HTMLDialogElement | null {
    return this.shadowRoot?.querySelector("dialog") ?? null;
  }

  private openDrawer(): void {
    const drawer = this.drawer();
    if (drawer && !drawer.open) drawer.showModal();
  }

  private readonly closeDrawer = (): void => {
    const drawer = this.drawer();
    if (drawer?.open) drawer.close();
  };

  /** Un clic sur le voile (hors du panneau) arrive sur le `<dialog>` lui-même : il ferme le tiroir. */
  private onDrawerClick(event: Event): void {
    if (event.target === event.currentTarget) this.closeDrawer();
  }

  /** Lien d'évitement : un bouton qui place le focus sur la page (une ancre `#` viserait le document, pas cette racine). */
  private skipToContent(): void {
    this.shadowRoot?.getElementById("content")?.focus();
  }

  /** L'organisation de l'adresse devient la dernière ouverte (retenue par ce navigateur). */
  private followAddress(): void {
    const fromAddress = currentOrgParam();
    if (fromAddress) {
      this.org = fromAddress;
      rememberOrg(fromAddress);
    }
    this.path = currentPath();
  }

  /**
   * ÉCHEC OUVERT : le sélecteur n'est qu'un raccourci. Sans liste, il montre l'organisation courante
   * (ou retenue) seule ; la page /orgs reste la voie principale et affiche l'erreur elle-même. Avec la
   * liste, une organisation retenue qui n'y est plus cède la place à la première.
   */
  private async loadOrgs(): Promise<void> {
    try {
      this.orgs = (await api.orgs()).orgs;
      if (!currentOrgParam()) this.org = defaultOrgOf(this.orgs.map((org) => org.login), this.org || null) ?? "";
    } catch (err) {
      if (!(err instanceof ApiError || err instanceof TypeError)) throw err;
      this.orgs = [];
    }
  }

  /** Changer d'organisation garde l'onglet ouvert (tableau de bord ou dépôts). */
  private onOrgChange(login: string): void {
    const onDashboard = this.path.endsWith("/dashboard");
    go(`/orgs/${encodeURIComponent(login)}${onDashboard ? "/dashboard" : ""}`);
  }

  /**
   * ÉCHEC FERMÉ : si le serveur n'a pas effacé la session, on ne prétend pas être déconnecté — le
   * message reste affiché et l'utilisateur peut réessayer. Une fois déconnecté, rechargement complet :
   * sélection, exécutions suivies et leur minuterie ne survivent pas à la session (sinon le prochain
   * relevé tomberait sur un 401 et renverrait vers la connexion avec « session ended »).
   */
  private async onSignOut(): Promise<void> {
    this.signingOut = true;
    this.signOutFailed = false;
    try {
      await api.signOut();
      forgetSession();
      location.assign("/login");
    } catch (err) {
      if (!(err instanceof ApiError || err instanceof TypeError)) throw err;
      this.signOutFailed = true;
    } finally {
      this.signingOut = false;
    }
  }
}
