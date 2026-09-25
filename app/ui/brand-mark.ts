import { html, type TemplateResult } from "lit";
import { cn } from "./class-names.ts";

/**
 * Logo EasyActions (engrenage + flèche), repris à l'identique du pack v2 (`EasyActions-Logo-Pack-v2.zip`,
 * svg/easyactions-mark.svg et svg/easyactions-icon-small-dark.svg). Ce sont les couleurs de la marque,
 * pas des jetons MASKAI : docs/ARCHITECTURE.md §9.
 * Jusqu'à 32 px, le dessin simplifié du pack (6 dents, chevron seul) : à cette taille, la flèche
 * complète se lisait « + ».
 */
interface Drawing {
  readonly gear: string;
  readonly corner: number;
  readonly coreR: number;
  readonly glyph: string;
  readonly glyphWidth: number;
}

const STANDARD: Drawing = {
  gear: "M 223.7 97.25 L 229.56 67.85 A 190 190 0 0 1 282.44 67.85 L 288.3 97.25 A 162 162 0 0 1 323.18 108.59 L 345.2 88.24 A 190 190 0 0 1 387.99 119.33 L 375.44 146.55 A 162 162 0 0 1 397 176.23 L 426.77 172.71 A 190 190 0 0 1 443.11 223.01 L 416.96 237.66 A 162 162 0 0 1 416.96 274.34 L 443.11 288.99 A 190 190 0 0 1 426.77 339.29 L 397 335.77 A 162 162 0 0 1 375.44 365.45 L 387.99 392.67 A 190 190 0 0 1 345.2 423.76 L 323.18 403.41 A 162 162 0 0 1 288.3 414.75 L 282.44 444.15 A 190 190 0 0 1 229.56 444.15 L 223.7 414.75 A 162 162 0 0 1 188.82 403.41 L 166.8 423.76 A 190 190 0 0 1 124.01 392.67 L 136.56 365.45 A 162 162 0 0 1 115 335.77 L 85.23 339.29 A 190 190 0 0 1 68.89 288.99 L 95.04 274.34 A 162 162 0 0 1 95.04 237.66 L 68.89 223.01 A 190 190 0 0 1 85.23 172.71 L 115 176.23 A 162 162 0 0 1 136.56 146.55 L 124.01 119.33 A 190 190 0 0 1 166.8 88.24 L 188.82 108.59 A 162 162 0 0 1 223.7 97.25 Z M 256 138 A 118 118 0 1 0 256 374 A 118 118 0 1 0 256 138 Z",
  corner: 12,
  coreR: 98,
  glyph: "M 202 256 H 300 M 262 214 L 306 256 L 262 298",
  glyphWidth: 30,
};

const SMALL: Drawing = {
  gear: "M 197.4 85.81 L 207.86 47.48 A 214 214 0 0 1 304.14 47.48 L 314.6 85.81 A 180 180 0 0 1 374.09 120.15 L 412.51 110.05 A 214 214 0 0 1 460.65 193.43 L 432.69 221.65 A 180 180 0 0 1 432.69 290.35 L 460.65 318.57 A 214 214 0 0 1 412.51 401.95 L 374.09 391.85 A 180 180 0 0 1 314.6 426.19 L 304.14 464.52 A 214 214 0 0 1 207.86 464.52 L 197.4 426.19 A 180 180 0 0 1 137.91 391.85 L 99.49 401.95 A 214 214 0 0 1 51.35 318.57 L 79.31 290.35 A 180 180 0 0 1 79.31 221.65 L 51.35 193.43 A 214 214 0 0 1 99.49 110.05 L 137.91 120.15 A 180 180 0 0 1 197.4 85.81 Z M 256 124 A 132 132 0 1 0 256 388 A 132 132 0 1 0 256 124 Z",
  corner: 16,
  coreR: 124,
  glyph: "M 228 190 L 294 256 L 228 322",
  glyphWidth: 58,
};

export type BrandMarkSize = 24 | 28 | 32 | 48 | 64;

/** Le symbole seul, décoratif (`aria-hidden`) : le nom de la marque l'accompagne toujours en texte. */
export function brandMark(size: BrandMarkSize): TemplateResult {
  const drawing = size <= 32 ? SMALL : STANDARD;
  return html`<svg viewBox="0 0 512 512" width=${size} height=${size} aria-hidden="true" class="shrink-0">
    <defs>
      <linearGradient id="ea-gear" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#6EE7A8"></stop>
        <stop offset="0.5" stop-color="#22C55E"></stop>
        <stop offset="1" stop-color="#047857"></stop>
      </linearGradient>
    </defs>
    <path
      d=${drawing.gear}
      fill="url(#ea-gear)"
      fill-rule="evenodd"
      stroke="url(#ea-gear)"
      stroke-width=${drawing.corner}
      stroke-linejoin="round"
    ></path>
    <circle cx="256" cy="256" r=${drawing.coreR} fill="#065F32"></circle>
    <path
      d=${drawing.glyph}
      fill="none"
      stroke="#FFFFFF"
      stroke-width=${drawing.glyphWidth}
      stroke-linecap="round"
      stroke-linejoin="round"
    ></path>
  </svg>`;
}

/**
 * Rotation de l'engrenage autour de son centre (celui de la grille 512), lente ; arrêtée sous
 * `prefers-reduced-motion`. Classes écrites en entier : Tailwind ne génère que ce qu'il lit.
 */
const GEAR_TURN = "animate-spin [animation-duration:1.6s] origin-center [transform-box:view-box] motion-reduce:animate-none";

/**
 * Attente d'une page ou d'une zone : le logo en couleurs, seul l'engrenage tourne (la flèche reste
 * immobile). Décoratif : l'appelant porte `role="status"` et le texte de l'attente.
 */
export function brandLoader(size: 48 | 64): TemplateResult {
  return html`<svg viewBox="0 0 512 512" width=${size} height=${size} aria-hidden="true" class="shrink-0">
    <defs>
      <linearGradient id="ea-gear" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#6EE7A8"></stop>
        <stop offset="0.5" stop-color="#22C55E"></stop>
        <stop offset="1" stop-color="#047857"></stop>
      </linearGradient>
    </defs>
    <path
      class=${GEAR_TURN}
      d=${STANDARD.gear}
      fill="url(#ea-gear)"
      fill-rule="evenodd"
      stroke="url(#ea-gear)"
      stroke-width=${STANDARD.corner}
      stroke-linejoin="round"
    ></path>
    <circle cx="256" cy="256" r=${STANDARD.coreR} fill="#065F32"></circle>
    <path d=${STANDARD.glyph} fill="none" stroke="#FFFFFF" stroke-width=${STANDARD.glyphWidth} stroke-linecap="round" stroke-linejoin="round"></path>
  </svg>`;
}

/**
 * Indicateur d'attente dans un bouton, un toast, une pastille : l'engrenage seul, de la couleur du
 * texte (`currentColor`, donc lisible sur un bouton vert), qui tourne. Remplace le bouclier de MaskAI.
 */
export function brandSpinner(size: 16 | 20, className = ""): TemplateResult {
  return html`<svg viewBox="0 0 512 512" width=${size} height=${size} aria-hidden="true" class=${cn("shrink-0", GEAR_TURN, className)}>
    <path d=${SMALL.gear} fill="currentColor" fill-rule="evenodd" stroke="currentColor" stroke-width=${SMALL.corner} stroke-linejoin="round"></path>
  </svg>`;
}

const WORDMARK_SIZE = {
  md: "text-base",
  lg: "text-2xl",
} as const;

/** Le nom en deux tons, comme le logo : « Easy » en encre de marque, « Actions » en vert. */
export function wordmark(size: keyof typeof WORDMARK_SIZE): TemplateResult {
  return html`<span class=${cn("font-bold tracking-tight", WORDMARK_SIZE[size])}
    ><span class="text-text-brand">Easy</span><span class="text-primary-text">Actions</span></span
  >`;
}
