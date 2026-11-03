import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "@/components/ui";

const VARIANTS = {
  primary: "bg-accent text-accent-fg hover:bg-accent-hover",
  secondary: "bg-surface border border-line-strong text-fg hover:bg-surface-2",
  ghost: "text-fg-2 hover:bg-surface-2 hover:text-fg",
} as const;

const SIZES = { sm: "h-8 px-3 text-sm", md: "h-10 px-4 text-sm", lg: "h-12 px-5 text-base" } as const;

/** A link that looks like a Button (avoids nesting a <button> inside an <a>). */
export function LinkButton({ href, children, variant = "secondary", size = "md", className, ...rest }: { href: string; children: ReactNode; variant?: keyof typeof VARIANTS; size?: keyof typeof SIZES; className?: string; "aria-label"?: string }) {
  return (
    <Link href={href} className={cx("inline-flex items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap transition-colors select-none", VARIANTS[variant], SIZES[size], className)} {...rest}>
      {children}
    </Link>
  );
}
