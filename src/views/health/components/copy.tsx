"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { cx } from "@/components/ui";

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for browsers/contexts without the async clipboard API.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    document.body.removeChild(ta);
    return ok;
  }
}

export function CopyButton({ text, label, className }: { text: string; label: string; className?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <button
      type="button"
      onClick={async () => {
        const ok = await copyText(text);
        setState(ok ? "copied" : "failed");
        setTimeout(() => setState("idle"), 2000);
      }}
      aria-label={label}
      className={cx("inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3 text-xs font-medium text-fg-2 hover:bg-surface-2", className)}
    >
      {state === "copied" ? <Check className="size-3.5 text-good" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      <span aria-live="polite">{state === "copied" ? "Copied" : state === "failed" ? "Select & copy" : "Copy"}</span>
    </button>
  );
}

/** A value on one line with a copy button (endpoint URL, token, header). */
export function CopyField({ label, value, mono = true, secret }: { label: string; value: string; mono?: boolean; secret?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-medium text-muted">{label}</p>
      <div className="flex items-center gap-2">
        <code className={cx("min-w-0 flex-1 rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs break-all text-fg select-all", mono && "font-mono", secret && "border-warning/50")}>{value}</code>
        <CopyButton text={value} label={`Copy ${label.toLowerCase()}`} />
      </div>
    </div>
  );
}

export function CodeBlock({ code, label }: { code: string; label: string }) {
  return (
    <div className="relative rounded-lg border border-line bg-surface-2">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-1.5">
        <span className="text-xs font-medium text-muted">{label}</span>
        <CopyButton text={code} label={`Copy ${label.toLowerCase()}`} className="h-8" />
      </div>
      <pre className="max-h-96 overflow-auto px-3 py-2 font-mono text-[11px] leading-relaxed text-fg">
        <code>{code}</code>
      </pre>
    </div>
  );
}
