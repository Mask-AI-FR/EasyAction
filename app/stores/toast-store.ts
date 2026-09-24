import { createStore } from "@tinijs/store";

export type ToastTone = "info" | "success" | "error" | "loading";

export interface ToastAction {
  readonly label: string;
  readonly run: () => void;
}

export interface Toast {
  readonly id: number;
  readonly tone: ToastTone;
  readonly title: string;
  readonly description?: string;
  readonly action?: ToastAction;
}

export type ToastContent = Omit<Toast, "id">;

/** Durée d'un toast ordinaire, reprise de MaskAI-Frontend `components/ui/sonner.tsx` (4 s). */
const DURATION_MS = 4000;

/** Toasts affichés par `<app-toaster>`, du plus ancien au plus récent. */
export const toastStore = createStore<{ toasts: readonly Toast[] }>({ toasts: [] });

let nextId = 1;
const timers = new Map<number, ReturnType<typeof setTimeout>>();

export function showToast(content: ToastContent): number {
  const id = nextId++;
  toastStore.commit("toasts", [...toastStore.toasts, { ...content, id }]);
  scheduleDismiss(id, content);
  return id;
}

/**
 * Remplace un toast (une attente qui devient un résultat). S'il a été fermé entre-temps, il revient :
 * le résultat d'un lancement doit toujours s'afficher.
 */
export function updateToast(id: number, content: ToastContent): void {
  const others = toastStore.toasts.filter((toast) => toast.id !== id);
  toastStore.commit("toasts", [...others, { ...content, id }]);
  scheduleDismiss(id, content);
}

export function dismissToast(id: number): void {
  clearTimeout(timers.get(id));
  timers.delete(id);
  toastStore.commit("toasts", toastStore.toasts.filter((toast) => toast.id !== id));
}

/**
 * Seul un toast d'information sans action s'efface seul. Une attente, une erreur ou un résultat à
 * consulter (« View details ») restent jusqu'à leur fermeture : l'issue d'un lancement ne doit pas
 * disparaître avant d'avoir été lue (WCAG 2.2.1).
 */
function scheduleDismiss(id: number, content: ToastContent): void {
  clearTimeout(timers.get(id));
  timers.delete(id);
  if (content.tone === "loading" || content.tone === "error" || content.action) return;
  timers.set(id, setTimeout(() => dismissToast(id), DURATION_MS));
}
