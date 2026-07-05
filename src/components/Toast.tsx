import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { CheckCircle2 } from 'lucide-react';

// UI-2 — toasts de confirmation : un enregistrement reussi le DIT (avant : redirection muette).
// useToast() est un no-op hors provider -> les ecrans restent testables sans lui.
interface ToastItem {
  id: number;
  message: string;
}

const ToastContext = createContext<{ toast(message: string): void }>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

const TOAST_MS = 4000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const toast = useCallback((message: string) => {
    const id = ++idRef.current;
    setItems((list) => [...list, { id, message }]);
    setTimeout(() => setItems((list) => list.filter((x) => x.id !== id)), TOAST_MS);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2" role="status" aria-live="polite">
        {items.map((x) => (
          <div key={x.id} className="pointer-events-auto flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 shadow-lg dark:border-slate-700 dark:bg-slate-900">
            <CheckCircle2 size={16} className="shrink-0 text-teal-600" aria-hidden />
            {x.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
