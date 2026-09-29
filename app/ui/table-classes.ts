/**
 * Tableau MASKAI, porté de MaskAI-Frontend `components/ui/table.tsx:66-123` (commit 40f75a9), sur une
 * grille de `div` à rôles ARIA (`table`, `row`, `columnheader`, `cell`) : un `<table>` n'admet pas
 * d'éléments personnalisés entre ses lignes, or chaque ligne de dépôt est un composant (état propre).
 * Les lignes suivent les jetons de densité (`--row-height`, `--row-padding-x`, `--row-padding-y`).
 */
export const TABLE_CLASS =
  "overflow-x-auto rounded-lg border border-border bg-surface shadow-card";

/**
 * Colonnes partagées par l'en-tête et chaque ligne : case · dépôt · branche · pipeline · dernier push ·
 * langage · détail. Largeur minimale (le nom du dépôt garde ~10 rem) : sous elle, le tableau défile
 * horizontalement (`TABLE_CLASS`) au lieu d'écraser la colonne du nom.
 */
export const TABLE_COLUMNS = "grid min-w-[57rem] grid-cols-[2.75rem_minmax(0,1fr)_13rem_13rem_8rem_7rem_3rem] items-center";

export const TABLE_HEAD_CLASS =
  "t-eyebrow sticky top-0 z-[1] h-9 border-b border-border bg-surface-secondary/95 backdrop-blur-sm";

export const TABLE_ROW_CLASS =
  "min-h-(--row-height) border-b border-border transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] last:border-b-0 hover:bg-surface-hover";

export const TABLE_CELL_CLASS = "min-w-0 px-(--row-padding-x) py-(--row-padding-y)";

export const TABLE_HEAD_CELL_CLASS = "px-(--row-padding-x)";
