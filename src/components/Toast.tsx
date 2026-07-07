import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';

// UI-2 — toasts de confirmation : un enregistrement reussi le DIT (avant : redirection muette).
// useToast() est un no-op hors provider -> les ecrans restent testables sans lui.
type ToastVariant = 'success' | 'warning';

interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
}

const ToastContext = createContext<{ toast(message: string, variant?: ToastVariant): void }>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

const TOAST_MS = 3000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const toast = useCallback((message: string, variant: ToastVariant = 'success') => {
    const id = ++idRef.current;
    setItems((list) => [...list, { id, message, variant }]);
    setTimeout(() => setItems((list) => list.filter((x) => x.id !== id)), TOAST_MS);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2" role="status" aria-live="polite">
        {items.map((x) => (
          <div
            key={x.id}
            className={`pointer-events-auto flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm shadow-lg ${
              x.variant === 'warning'
                ? 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100'
                : 'border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900'
            }`}
          >
            {x.variant === 'warning' ? (
              <AlertTriangle size={16} className="shrink-0 text-amber-600 dark:text-amber-300" aria-hidden />
            ) : (
              <CheckCircle2 size={16} className="shrink-0 text-teal-600" aria-hidden />
            )}
            {x.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
