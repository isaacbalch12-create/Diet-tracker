"use client";

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { Loader2, X } from "lucide-react";
import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

/** Class joiner that lets later Tailwind utilities override earlier ones (e.g. a width passed via className). */
export const cx = (...args: ClassValue[]) => twMerge(clsx(args));

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none select-none whitespace-nowrap";
const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-fg hover:bg-accent-hover",
  secondary: "bg-surface border border-line-strong text-fg hover:bg-surface-2",
  ghost: "text-fg-2 hover:bg-surface-2 hover:text-fg",
  danger: "bg-critical text-white hover:opacity-90",
};
const buttonSizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-5 text-base",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} className={cx(buttonBase, buttonVariants[variant], buttonSizes[size], className)} disabled={disabled || loading} {...rest}>
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
});

export function IconButton({ label, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button type="button" aria-label={label} title={label} className={cx("inline-flex size-9 items-center justify-center rounded-lg text-fg-2 hover:bg-surface-2 hover:text-fg disabled:opacity-40", className)} {...rest}>
      {children}
    </button>
  );
}

const fieldBase =
  "w-full rounded-lg border border-line-strong bg-surface px-3 text-fg placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 disabled:opacity-60";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cx(fieldBase, "h-10 text-sm", className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cx(fieldBase, "py-2 text-sm leading-relaxed", className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <select ref={ref} className={cx(fieldBase, "h-10 pr-8 text-sm", className)} {...rest}>
      {children}
    </select>
  );
});

export function Field({ label, hint, error, children, className }: { label: string; hint?: ReactNode; error?: string | null; children: (id: string) => ReactNode; className?: string }) {
  const id = useId();
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium text-fg-2">
        {label}
      </label>
      {children(id)}
      {hint && !error && <p className="text-xs text-muted">{hint}</p>}
      {error && (
        <p className="text-xs text-critical" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function Card({ className, children, ...rest }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx("rounded-xl border border-line bg-surface p-4 shadow-[var(--shadow)] sm:p-5", className)} {...rest}>
      {children}
    </div>
  );
}

export function CardTitle({ children, action, sub }: { children: ReactNode; action?: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-fg">{children}</h2>
        {sub && <p className="mt-0.5 text-sm text-muted">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

type BadgeTone = "neutral" | "accent" | "good" | "warning" | "critical" | "outline";
const badgeTones: Record<BadgeTone, string> = {
  neutral: "bg-surface-2 text-fg-2",
  accent: "bg-accent-soft text-accent",
  good: "bg-good-soft text-good-text",
  warning: "bg-warning-soft text-warning-text",
  critical: "bg-critical-soft text-critical",
  outline: "border border-line-strong text-fg-2",
};

export function Badge({ tone = "neutral", children, className, title }: { tone?: BadgeTone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cx("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium whitespace-nowrap", badgeTones[tone], className)}>
      {children}
    </span>
  );
}

export function Spinner({ className, label = "Loading" }: { className?: string; label?: string }) {
  return (
    <span role="status" className={cx("inline-flex items-center gap-2 text-sm text-muted", className)}>
      <Loader2 className="size-4 animate-spin" aria-hidden />
      <span>{label}…</span>
    </span>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong px-6 py-10 text-center">
      {icon && <div className="mb-1 text-muted">{icon}</div>}
      <p className="font-medium text-fg">{title}</p>
      {children && <div className="max-w-md text-sm text-muted">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorBanner({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div role="alert" className="flex items-start justify-between gap-3 rounded-lg border border-critical/30 bg-critical-soft px-3 py-2 text-sm text-critical">
      <span>{message}</span>
      {onRetry && (
        <button type="button" className="shrink-0 font-medium underline" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, options, label, size = "md" }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; label: string; size?: "sm" | "md" }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex max-w-full flex-wrap rounded-lg bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            "rounded-md font-medium whitespace-nowrap transition-colors",
            size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm",
            value === o.value ? "bg-surface text-fg shadow-sm" : "text-fg-2 hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Progress meter; the color carries identity, the label carries the numbers. */
export function Meter({ value, max, color, label, over }: { value: number; max: number; color: string; label: string; over?: boolean }) {
  const pctVal = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Math.round(max)}
      aria-valuenow={Math.round(value)}
      className="h-2 w-full overflow-hidden rounded-full bg-surface-3"
    >
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${pctVal}%`, background: over ? "var(--serious)" : color }} />
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={cx("m-auto w-[calc(100%-1.5rem)] rounded-2xl border border-line bg-surface p-0 text-fg shadow-xl", wide ? "max-w-3xl" : "max-w-lg")}
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 className="text-base font-semibold">{title}</h2>
            <IconButton label="Close" onClick={onClose}>
              <X className="size-4" />
            </IconButton>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
        </div>
      )}
    </dialog>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded-lg bg-surface-2", className)} />;
}

export function Stat({ label, value, sub, className }: { label: string; value: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={cx("min-w-0", className)}>
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className="mt-0.5 truncate text-xl font-semibold text-fg">{value}</p>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}
