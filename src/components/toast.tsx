"use client";

import { CheckCircle2, AlertTriangle, X } from "lucide-react";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

interface Toast {
  id: number;
  kind: "success" | "error" | "info";
  message: string;
  action?: { label: string; onClick: () => void };
}

const ToastCtx = createContext<(t: Omit<Toast, "id">) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev.slice(-3), { ...t, id }]);
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), t.kind === "error" ? 7000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 md:bottom-6">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.kind === "error" ? "alert" : "status"}
            className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-sm text-fg shadow-lg"
          >
            {t.kind === "error" ? <AlertTriangle className="size-4 shrink-0 text-critical" aria-hidden /> : <CheckCircle2 className="size-4 shrink-0 text-good" aria-hidden />}
            <span className="flex-1">{t.message}</span>
            {t.action && (
              <button
                type="button"
                className="font-medium text-accent"
                onClick={() => {
                  t.action!.onClick();
                  setToasts((prev) => prev.filter((x) => x.id !== t.id));
                }}
              >
                {t.action.label}
              </button>
            )}
            <button type="button" aria-label="Dismiss" className="text-muted" onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}>
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const push = useContext(ToastCtx);
  return {
    success: (message: string, action?: Toast["action"]) => push({ kind: "success", message, action }),
    error: (err: unknown) => push({ kind: "error", message: err instanceof Error ? err.message : String(err) }),
    info: (message: string) => push({ kind: "info", message }),
  };
}
