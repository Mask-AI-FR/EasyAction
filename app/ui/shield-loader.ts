import { html, type TemplateResult } from "lit";
import { cn } from "./class-names.ts";

/**
 * Contour du bouclier MASKAI, repris de MaskAI-Frontend `components/MaskaiShield.tsx:62`
 * (commit 40f75a9) — même chaîne à l'octet près, pour que le logo et l'indicateur coïncident.
 */
export const SHIELD_OUTER_PATH = `M 32 4.5
             C 27 7.6, 17 10.6, 10.6 11.4
             C 10 17, 10 24, 10.7 30
             C 12 40, 20 51, 32 58.8
             C 44 51, 52 40, 53.3 30
             C 54 24, 54 17, 53.4 11.4
             C 47 10.6, 37 7.6, 32 4.5 Z`;

/** 16 (dans un bouton) · 20 (défaut) · 32 (zone) · 48 (page), comme `ShieldLoader.tsx`. */
export type ShieldSize = 16 | 20 | 32 | 48;

/**
 * L'indicateur d'attente de la marque, porté de MaskAI-Frontend `components/ui/ShieldLoader.tsx` :
 * le contour se trace en boucle (`.shield-loader path`, globals.css), et s'arrête sous
 * `prefers-reduced-motion`. Couleur héritée (`currentColor`).
 */
export function shieldLoader(size: ShieldSize = 20, className = ""): TemplateResult {
  return shieldSvg(size, cn("shield-loader shrink-0", className));
}

/** Le même contour, immobile : la marque de l'en-tête et de la page de connexion. */
export function shieldMark(size: ShieldSize = 20, className = ""): TemplateResult {
  return shieldSvg(size, cn("shrink-0", className));
}

function shieldSvg(size: ShieldSize, className: string): TemplateResult {
  return html`<svg
    viewBox="0 0 64 64"
    width=${size}
    height=${size}
    fill="none"
    aria-hidden="true"
    class=${className}
  >
    <path
      d=${SHIELD_OUTER_PATH}
      stroke="currentColor"
      stroke-width=${size <= 20 ? 4 : 3.3}
      stroke-linejoin="round"
      stroke-linecap="round"
    ></path>
  </svg>`;
}
