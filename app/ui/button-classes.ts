import { cn } from "./class-names.ts";

/**
 * Classes d'un bouton MASKAI, portées de MaskAI-Frontend `components/ui/button.tsx:32-56`
 * (commit 40f75a9). On pose ces classes sur un `<button>` ou un `<a>` natif : pas d'élément
 * personnalisé, pour garder la sémantique et l'accessibilité natives.
 *
 * Écart volontaire avec l'original : les variantes `dark:` sont retirées. Dans un shadow root elles
 * ne peuvent pas voir `html.dark` et resteraient inertes ; le thème sombre passe par les jetons.
 * `btn-press` (globals.css) apporte le scale(0.97) au clic, avec son opt-out `prefers-reduced-motion`.
 */
const BASE_CLASS =
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-[color,background-color,border-color,box-shadow,transform] duration-[var(--duration-fast)] ease-[var(--ease-out)] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 btn-press";

const VARIANT_CLASS = {
  default:
    "bg-primary text-primary-foreground shadow-cta hover:bg-primary-hover hover:shadow-cta-hover",
  destructive:
    "bg-destructive text-primary-foreground hover:bg-signal-danger-text focus-visible:ring-destructive/20",
  outline:
    "border border-border-control bg-surface hover:bg-surface-hover hover:border-border-strong",
  secondary: "bg-surface-secondary text-text-primary hover:bg-surface-hover",
  ghost: "hover:bg-surface-hover hover:text-text-primary",
  link: "text-primary underline-offset-4 hover:underline",
} as const;

const SIZE_CLASS = {
  default: "h-9 px-4 py-2 has-[>svg]:px-3",
  xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
  sm: "h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5",
  lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
  icon: "size-9",
  "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
  "icon-sm": "size-8",
  "icon-lg": "size-10",
} as const;

export type ButtonVariant = keyof typeof VARIANT_CLASS;
export type ButtonSize = keyof typeof SIZE_CLASS;

export interface ButtonClassOptions {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
}

export function buttonClass({
  variant = "default",
  size = "default",
}: ButtonClassOptions = {}): string {
  return cn(BASE_CLASS, VARIANT_CLASS[variant], SIZE_CLASS[size]);
}
