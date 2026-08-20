type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
}

type Listener = (toasts: ToastItem[]) => void;

let nextId = 0;
let items: ToastItem[] = [];
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((fn) => fn([...items]));
}

function add(type: ToastType, message: string, duration = 4000) {
  const id = ++nextId;
  items = [...items, { id, type, message }];
  emit();
  setTimeout(() => remove(id), duration);
}

function remove(id: number) {
  items = items.filter((t) => t.id !== id);
  emit();
}

/** Basit, bağımlılıksız toast deposu; `<Toaster />` abone olur. */
export const toast = {
  success: (msg: string) => add('success', msg),
  error: (msg: string) => add('error', msg),
  warning: (msg: string) => add('warning', msg),
  info: (msg: string) => add('info', msg),
  remove,
  subscribe: (fn: Listener) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
