"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, MessageSquarePlus, Send, Sparkles, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, cx, EmptyState, ErrorBanner, IconButton, Select, Spinner, Textarea } from "@/components/ui";
import { api } from "@/lib/client/api";
import { useInvalidateData, useSettings } from "@/lib/client/hooks";
import type { AssistantActionJ } from "@/lib/client/types";

const SUGGESTIONS = [
  "How much protein have I eaten today?",
  "What are my average calories over the last 30 days?",
  "What did I eat yesterday?",
  "Which meals give me the most protein for their calories?",
  "How has my average weight changed over the last month?",
  "What are my most frequently eaten meals?",
  "Which nutrients am I consistently falling short on relative to my goals?",
  "Compare my diet this week with last week.",
  "Summarize my nutrition and weight trends over the last 90 days.",
];

const TOOL_LABEL: Record<string, string> = {
  get_day: "Reading a day's log",
  get_meals: "Looking through meals",
  get_nutrition_stats: "Calculating nutrition stats",
  get_weight_stats: "Calculating weight stats",
  get_food_rankings: "Ranking foods",
  compare_periods: "Comparing periods",
  get_goals_and_settings: "Checking your goals",
  get_weight_nutrition_relationship: "Comparing weight and intake",
  propose_action: "Preparing a change for you to confirm",
};

interface Conversation {
  id: string;
  title: string;
  updatedAt: string;
}

type Entry =
  | { kind: "user"; text: string; at: string }
  | { kind: "assistant"; text: string; at: string; tools?: { id: string; name: string; status: string }[]; streaming?: boolean }
  | { kind: "action"; action: AssistantActionJ; at: string };

function Markdown({ text }: { text: string }) {
  return (
    <div className="prose-sm max-w-none text-sm leading-relaxed text-fg [&_a]:text-accent [&_code]:rounded [&_code]:bg-surface-2 [&_code]:px-1 [&_li]:my-0.5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_strong]:font-semibold [&_table]:my-2 [&_table]:w-full [&_table]:text-xs [&_td]:border-b [&_td]:border-line [&_td]:px-2 [&_td]:py-1 [&_th]:border-b [&_th]:border-line [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: (props) => <a {...props} target="_blank" rel="noreferrer" /> }}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

function ActionCard({ action, onResolved }: { action: AssistantActionJ; onResolved: (a: AssistantActionJ) => void }) {
  const toast = useToast();
  const router = useRouter();
  const invalidate = useInvalidateData();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<"confirm" | "dismiss" | null>(null);
  const resolve = async (decision: "confirm" | "dismiss") => {
    setBusy(decision);
    try {
      const res = await api.post<{ action: AssistantActionJ }>(`/api/assistant/actions/${action.id}`, { decision });
      onResolved(res.action);
      if (decision === "confirm") {
        await invalidate();
        await qc.invalidateQueries({ queryKey: ["settings"] });
        const redirect = (res.action.result as { redirect?: string } | null)?.redirect;
        if (redirect) router.push(redirect);
        else toast.success("Done");
      }
    } catch (err) {
      toast.error(err);
      onResolved({ ...action, status: "failed", result: { error: err instanceof Error ? err.message : String(err) } });
    } finally {
      setBusy(null);
    }
  };
  const err = (action.result as { error?: string } | null)?.error;
  return (
    <div className="ml-0 flex flex-col gap-2 rounded-xl border border-accent/40 bg-accent-soft/50 p-3 sm:ml-10">
      <p className="text-xs font-medium tracking-wide text-accent uppercase">Proposed change — needs your confirmation</p>
      <p className="text-sm text-fg">{action.summary}</p>
      {action.status === "pending" ? (
        <div className="flex gap-2">
          <Button size="sm" onClick={() => resolve("confirm")} loading={busy === "confirm"} disabled={busy !== null}>
            <Check className="size-4" /> Confirm
          </Button>
          <Button size="sm" variant="secondary" onClick={() => resolve("dismiss")} loading={busy === "dismiss"} disabled={busy !== null}>
            <X className="size-4" /> Dismiss
          </Button>
        </div>
      ) : (
        <Badge tone={action.status === "confirmed" ? "good" : action.status === "failed" ? "critical" : "neutral"} className="w-fit">
          {action.status === "confirmed" ? "Confirmed" : action.status === "dismissed" ? "Dismissed" : `Failed${err ? `: ${err}` : ""}`}
        </Badge>
      )}
    </div>
  );
}

export function AssistantView() {
  const settingsQ = useSettings();
  const invalidate = useInvalidateData();
  const qc = useQueryClient();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const convs = useQuery({ queryKey: ["conversations"], queryFn: () => api.get<{ conversations: Conversation[] }>("/api/assistant/conversations").then((r) => r.conversations) });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [entries]);

  const open = async (id: string | null) => {
    setError(null);
    setConversationId(id);
    if (!id) {
      setEntries([]);
      return;
    }
    try {
      const res = await api.get<{ messages: { role: "user" | "assistant"; text: string; createdAt: string }[]; actions: AssistantActionJ[] }>(`/api/assistant/conversations/${id}`);
      const list: Entry[] = [
        ...res.messages.map((m) => (m.role === "user" ? { kind: "user" as const, text: m.text, at: m.createdAt } : { kind: "assistant" as const, text: m.text, at: m.createdAt })),
        ...res.actions.map((a) => ({ kind: "action" as const, action: a, at: a.createdAt })),
      ].sort((a, b) => a.at.localeCompare(b.at));
      setEntries(list);
    } catch (err) {
      setError(err);
    }
  };

  const remove = async () => {
    if (!conversationId || !window.confirm("Delete this conversation? Your food and weight records are not affected.")) return;
    await api.del(`/api/assistant/conversations/${conversationId}`).catch(() => undefined);
    await qc.invalidateQueries({ queryKey: ["conversations"] });
    open(null);
  };

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || sending) return;
    setInput("");
    setError(null);
    setSending(true);
    const now = new Date().toISOString();
    setEntries((prev) => [...prev, { kind: "user", text: message, at: now }, { kind: "assistant", text: "", at: now, tools: [], streaming: true }]);
    const patchAssistant = (fn: (e: Extract<Entry, { kind: "assistant" }>) => Extract<Entry, { kind: "assistant" }>) =>
      setEntries((prev) => {
        const idx = prev.map((e) => e.kind).lastIndexOf("assistant");
        if (idx < 0) return prev;
        const copy = [...prev];
        copy[idx] = fn(copy[idx] as Extract<Entry, { kind: "assistant" }>);
        return copy;
      });
    let changed = false;
    try {
      const res = await fetch("/api/assistant/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId, message }) });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error?.message ?? `Request failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const ev = JSON.parse(line);
          if (ev.type === "conversation") {
            setConversationId(ev.id);
          } else if (ev.type === "text") {
            patchAssistant((e) => ({ ...e, text: e.text + ev.delta }));
          } else if (ev.type === "turn") {
            patchAssistant((e) => ({ ...e, text: e.text && !e.text.endsWith("\n\n") ? `${e.text}\n\n` : e.text }));
          } else if (ev.type === "tool") {
            patchAssistant((e) => {
              const tools = (e.tools ?? []).filter((t) => t.id !== ev.id);
              return { ...e, tools: [...tools, { id: ev.id, name: ev.name, status: ev.status }] };
            });
          } else if (ev.type === "action") {
            changed = true;
            setEntries((prev) => [...prev, { kind: "action", action: ev.action, at: new Date().toISOString() }]);
          } else if (ev.type === "error") {
            setError(new Error(ev.message));
          }
        }
      }
    } catch (err) {
      setError(err);
    } finally {
      patchAssistant((e) => ({ ...e, streaming: false }));
      setSending(false);
      await qc.invalidateQueries({ queryKey: ["conversations"] });
      if (changed) await invalidate();
    }
  };

  if (!settingsQ.data) return null;
  const aiConfigured = settingsQ.data.status.aiConfigured;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <Sparkles className="size-5 text-accent" /> Nutrition assistant
        </h1>
        <div className="flex items-center gap-2">
          {convs.data && convs.data.length > 0 && (
            <Select aria-label="Conversation" value={conversationId ?? ""} onChange={(e) => open(e.target.value || null)} className="h-9 max-w-[14rem]">
              <option value="">New conversation</option>
              {convs.data.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </Select>
          )}
          <Button variant="secondary" size="sm" onClick={() => open(null)} disabled={sending}>
            <MessageSquarePlus className="size-4" /> New
          </Button>
          {conversationId && (
            <IconButton label="Delete conversation" onClick={remove}>
              <Trash2 className="size-4" />
            </IconButton>
          )}
        </div>
      </div>

      {!aiConfigured ? (
        <EmptyState icon={<Sparkles className="size-8" />} title="The assistant needs an Anthropic API key">
          Set <code>ANTHROPIC_API_KEY</code> on the server and restart. Everything else in the app works without it.
        </EmptyState>
      ) : (
        <Card className="flex min-h-[60vh] flex-col p-0 sm:p-0">
          <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5" aria-live="polite">
            {entries.length === 0 ? (
              <div className="flex flex-col gap-4">
                <p className="text-sm text-fg-2">Ask about your own logs, goals and trends. Answers are calculated from your stored data; changes you request are shown for confirmation first.</p>
                <div className="flex flex-wrap gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} type="button" onClick={() => send(s)} className="rounded-full border border-line-strong px-3 py-1.5 text-left text-sm text-fg-2 hover:bg-surface-2">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <ul className="flex flex-col gap-4">
                {entries.map((e, i) => (
                  <li key={i}>
                    {e.kind === "user" ? (
                      <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-accent px-4 py-2 text-sm whitespace-pre-wrap text-accent-fg">{e.text}</div>
                    ) : e.kind === "action" ? (
                      <ActionCard action={e.action} onResolved={(a) => setEntries((prev) => prev.map((x) => (x.kind === "action" && x.action.id === a.id ? { ...x, action: a } : x)))} />
                    ) : (
                      <div className="flex gap-3">
                        <span className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
                          <Sparkles className="size-3.5" aria-hidden />
                        </span>
                        <div className="min-w-0 flex-1">
                          {e.tools && e.tools.length > 0 && (
                            <ul className="mb-1 flex flex-wrap gap-1.5">
                              {e.tools.map((t) => (
                                <li key={t.id}>
                                  <Badge tone={t.status === "error" ? "critical" : "outline"}>
                                    {t.status === "start" ? <Loader2 className="size-3 animate-spin" /> : t.status === "done" ? <Check className="size-3" /> : <X className="size-3" />}
                                    {TOOL_LABEL[t.name] ?? t.name}
                                  </Badge>
                                </li>
                              ))}
                            </ul>
                          )}
                          {e.text ? <Markdown text={e.text} /> : e.streaming ? <Spinner label="Thinking" /> : null}
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <div ref={bottomRef} />
          </div>
          {error ? (
            <div className="px-4 pb-2 sm:px-5">
              <ErrorBanner error={error} />
            </div>
          ) : null}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="flex items-end gap-2 border-t border-line p-3"
          >
            <Textarea
              aria-label="Message"
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              placeholder="Ask about your nutrition, weight or goals…"
              className={cx("max-h-40 min-h-10 resize-none")}
            />
            <Button type="submit" disabled={!input.trim() || sending} loading={sending} aria-label="Send">
              <Send className="size-4" />
            </Button>
          </form>
        </Card>
      )}
      <p className="text-xs text-muted">The assistant offers general information based on your logs, not medical advice.</p>
    </div>
  );
}
