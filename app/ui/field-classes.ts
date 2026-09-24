/**
 * Champs de formulaire MASKAI, portés de MaskAI-Frontend (commit 40f75a9) : `components/ui/input.tsx:24`
 * (saisie), le déclencheur de `select.tsx:60` (liste native ici) et `badge.tsx:23-34` (pastilles).
 * On les pose sur des éléments natifs — `<input>`, `<select>` — qui gardent clavier et lecteurs d'écran.
 * Écarts volontaires : pas de variante `dark:` (inerte en shadow DOM) ; la case à cocher native prend la
 * couleur de marque par `accent-color` au lieu du rendu Radix.
 */
export const INPUT_CLASS =
  "h-9 w-full min-w-0 rounded-md border border-border-control bg-transparent px-3 py-1 text-sm text-text-primary shadow-xs transition-[border-color,box-shadow,background-color] duration-[var(--duration-fast)] ease-[var(--ease-out)] outline-none placeholder:text-text-tertiary hover:border-border-strong focus-visible:border-text-tertiary disabled:pointer-events-none disabled:opacity-50";

export const SELECT_CLASS =
  "h-9 rounded-md border border-border-control bg-surface px-3 text-sm text-text-primary shadow-xs transition-[color,background-color,border-color,box-shadow] duration-[var(--duration-fast)] ease-[var(--ease-out)] outline-none hover:border-border-strong hover:bg-surface-hover focus-visible:border-text-tertiary disabled:cursor-not-allowed disabled:opacity-50";

export const CHECKBOX_CLASS =
  "size-4 shrink-0 cursor-pointer rounded-[4px] border border-border-control accent-(--primary) disabled:cursor-not-allowed disabled:opacity-50";

export const BADGE_CLASS =
  "inline-flex w-fit shrink-0 items-center gap-1 rounded-full border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap";

/** Pastille neutre (`secondary` de l'original) et pastille à contour (`outline`). */
export const BADGE_TONE = {
  neutral: "bg-surface-secondary text-text-secondary",
  outline: "border-border text-text-secondary",
} as const;
