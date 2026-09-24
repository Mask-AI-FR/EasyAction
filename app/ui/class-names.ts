import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * `cn` — fusion de classes Tailwind, portée de MaskAI-Frontend `lib/utils.ts` (commit 40f75a9).
 * Renommée : CLAUDE.md §5.2 proscrit les modules « utils ».
 *
 * On étend tailwind-merge au lieu d'utiliser son `twMerge` nu : le système MASKAI définit deux
 * échelles hors du vocabulaire standard — tailles de police `text-3xs` / `text-2xs`, élévations
 * `shadow-cta` / `shadow-card` / `shadow-popover`… Sans cette déclaration, tailwind-merge range
 * `text-2xs` parmi les couleurs et garde deux classes en conflit (`text-2xs text-sm` survivent toutes
 * les deux), dont la gagnante dépend alors de l'ordre de la feuille compilée.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        { text: ["3xs", "2xs", "xs", "sm", "base", "lg", "xl", "2xl"] },
      ],
      shadow: [
        {
          shadow: [
            "cta",
            "cta-hover",
            "card",
            "popover",
            "toast",
            "modal",
            "glass",
            "glow",
          ],
        },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
