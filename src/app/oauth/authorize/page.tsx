import type { Metadata } from "next";
import { headers } from "next/headers";
import { Link2, ShieldCheck, UtensilsCrossed } from "lucide-react";
import { getDb } from "@/lib/db";
import { checkAuthorizeRequest, publicOrigin } from "@/lib/services/oauth";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Connect Claude" };
export const dynamic = "force-dynamic";

/**
 * OAuth consent screen. The proxy sends visitors without a session to the
 * login page first, so only the signed-in owner sees this and can approve.
 */
export default async function Page({ searchParams }: PageProps<"/oauth/authorize">) {
  const sp = await searchParams;
  const raw: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string") raw[k] = v;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
  const proto = h.get("x-forwarded-proto")?.split(",")[0] ?? "https";
  const origin = publicOrigin(new Request(`${proto}://${host}/oauth/authorize`, { headers: h }));
  const check = await checkAuthorizeRequest(await getDb(), raw, origin);
  if (!check.ok && check.redirect) redirect(check.to);

  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="flex w-full max-w-md flex-col gap-4 rounded-2xl border border-line bg-surface p-6 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="flex size-9 items-center justify-center rounded-lg bg-accent text-accent-fg">
            <UtensilsCrossed className="size-4" />
          </span>
          <h1 className="text-lg font-semibold">Connect to Momentum</h1>
        </div>
        {check.ok ? (
          <>
            <p className="text-sm text-fg-2">
              <span className="font-medium text-fg">{check.clientName}</span> wants to connect to your Momentum account.
            </p>
            <ul className="flex flex-col gap-2 text-sm text-fg-2">
              <li className="flex gap-2">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
                It can read your logs (meals, weight, training, runs, health, routines, goals) and log or delete meals for you.
              </li>
              <li className="flex gap-2">
                <Link2 className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
                You&apos;ll return to <span className="font-medium text-fg">{check.redirectHost}</span>. You can disconnect it anytime in Settings.
              </li>
            </ul>
            <form method="post" action="/api/oauth/authorize" className="flex gap-2">
              {Object.entries(raw).map(([k, v]) => (k === "decision" ? null : <input key={k} type="hidden" name={k} value={v} />))}
              <button type="submit" name="decision" value="deny" className="h-11 flex-1 rounded-lg border border-line bg-surface font-medium text-fg hover:bg-surface-2">
                Cancel
              </button>
              <button type="submit" name="decision" value="allow" className="h-11 flex-1 rounded-lg bg-accent font-medium text-accent-fg hover:opacity-90">
                Allow
              </button>
            </form>
          </>
        ) : (
          <p role="alert" className="text-sm text-critical">
            {check.message}
          </p>
        )}
      </div>
    </main>
  );
}
