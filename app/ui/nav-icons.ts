import { html, svg } from "lit";

/**
 * Icônes de la navigation, dessinées ici sans bibliothèque : grille de 24, trait de 2 px arrondi,
 * `currentColor` (la famille visuelle des icônes Lucide de MaskAI-Frontend, pas leurs tracés).
 * Toujours décoratives : le libellé voisin, ou l'`aria-label` du bouton, nomme l'action.
 */
export type NavIconName =
  | "dashboard"
  | "repositories"
  | "organizations"
  | "settings"
  | "users"
  | "history"
  | "signOut"
  | "switch"
  | "menu"
  | "close";

const SHAPES: Record<NavIconName, ReturnType<typeof svg>> = {
  dashboard: svg`<rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" />
    <rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" />`,
  repositories: svg`<path d="M5 19.5v-15A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5Zm0 0A1.5 1.5 0 0 0 6.5 21H19v-3" />
    <path d="M9 7h6" />`,
  organizations: svg`<path d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16" /><path d="M16 9h2a2 2 0 0 1 2 2v10" />
    <path d="M3 21h18M8 7h4M8 11h4M8 15h4" />`,
  settings: svg`<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" />
    <circle cx="18" cy="18" r="2" />`,
  users: svg`<circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7" />
    <path d="M18 14.5a6.5 6.5 0 0 1 3.5 5.5" />`,
  history: svg`<path d="M3 12a9 9 0 1 0 2.64-6.36" /><path d="M3 4v4.5h4.5" /><path d="M12 7.5V12l3 2" />`,
  signOut: svg`<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" /><path d="M10 16l-4-4 4-4M6 12h10" />`,
  switch: svg`<path d="M8 9l4-4 4 4M8 15l4 4 4-4" />`,
  menu: svg`<path d="M4 6h16M4 12h16M4 18h16" />`,
  close: svg`<path d="M6 6l12 12M18 6L6 18" />`,
};

/** L'icône à 16 px par défaut ; `className` règle la taille et la couleur (classes écrites en entier). */
export function navIcon(name: NavIconName, className = "size-4 shrink-0") {
  return html`<svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    class=${className}
  >${SHAPES[name]}</svg>`;
}
