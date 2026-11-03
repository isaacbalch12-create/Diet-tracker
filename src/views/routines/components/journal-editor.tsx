"use client";

import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useToast } from "@/components/toast";
import { Button, Field, Modal, Textarea } from "@/components/ui";
import { api } from "@/lib/client/api";
import { useInvalidateData } from "@/lib/client/hooks";
import type { JournalEntryJ } from "@/lib/client/types";
import { createAutosaver, putJson, SaveIndicator, type JournalPrompt, type SaveStatus, type Slot } from "./shared";

interface Draft {
  body: string;
  answers: { promptId: string; prompt: string; answer: string }[];
}

interface ShownPrompt {
  id: string;
  text: string;
  /** Answered on this entry but no longer an enabled prompt. */
  archived: boolean;
}

/** Enabled prompts, plus any prompt this entry already answered (kept so old answers stay visible and editable). */
function shownPrompts(prompts: JournalPrompt[], entry: JournalEntryJ | null): ShownPrompt[] {
  const out: ShownPrompt[] = prompts.filter((p) => p.enabled).map((p) => ({ id: p.id, text: p.text, archived: false }));
  for (const a of entry?.answers ?? []) {
    if (!out.some((p) => p.id === a.promptId)) out.push({ id: a.promptId, text: a.prompt, archived: true });
  }
  return out;
}

export function hasJournalContent(e: Pick<JournalEntryJ, "body" | "answers">): boolean {
  return e.body.trim().length > 0 || e.answers.some((a) => a.answer.trim().length > 0);
}

/**
 * Prompted answers plus free writing, autosaved (debounced) with PUT /api/journal.
 * Mount with a `key` of date + slot: each instance edits exactly one entry.
 */
export function JournalEditor({
  date,
  slot,
  entry,
  prompts,
  journalActivityIds = [],
  allowDelete = false,
  onDeleted,
  bodyLabel = "Free writing",
}: {
  date: string;
  slot: Slot;
  entry: JournalEntryJ | null;
  prompts: JournalPrompt[];
  /** Journal activities ticked for this day; un-ticked when the entry is deleted. */
  journalActivityIds?: string[];
  allowDelete?: boolean;
  onDeleted?: () => void;
  bodyLabel?: string;
}) {
  const toast = useToast();
  const invalidate = useInvalidateData();
  const [shown] = useState(() => shownPrompts(prompts, entry));
  const [body, setBody] = useState(entry?.body ?? "");
  const [answers, setAnswers] = useState<Record<string, string>>(() => Object.fromEntries((entry?.answers ?? []).map((a) => [a.promptId, a.answer])));
  const [status, setStatus] = useState<SaveStatus>(entry ? "saved" : "idle");
  const [savedId, setSavedId] = useState<string | null>(entry?.id ?? null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [saver] = useState(() => {
    let entryId = entry?.id ?? null;
    return createAutosaver<Draft>(
      async (d) => {
        if (!entryId && !hasJournalContent(d)) return;
        const res = await putJson<{ entry: JournalEntryJ }>("/api/journal", { localDate: date, slot, body: d.body, answers: d.answers });
        entryId = res.entry.id;
        setSavedId(res.entry.id);
        await invalidate();
      },
      (s) => setStatus(s),
    );
  });

  // Save anything still pending when leaving (date change, navigation within the app).
  useEffect(() => () => void saver.flush(), [saver]);

  // Warn before closing the tab with unsaved writing.
  useEffect(() => {
    if (status !== "pending" && status !== "saving") return;
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [status]);

  const draft = (nextBody: string, nextAnswers: Record<string, string>): Draft => ({
    body: nextBody,
    answers: shown.map((p) => ({ promptId: p.id, prompt: p.text, answer: nextAnswers[p.id] ?? "" })).filter((a) => a.answer.trim()),
  });

  const changeAnswer = (id: string, v: string) => {
    const next = { ...answers, [id]: v };
    setAnswers(next);
    saver.push(draft(body, next));
  };
  const changeBody = (v: string) => {
    setBody(v);
    saver.push(draft(v, answers));
  };

  const remove = async () => {
    if (!savedId) return;
    setDeleting(true);
    saver.cancel();
    try {
      await api.del(`/api/journal/${savedId}`);
      // Deleting the entry means it wasn't journaled: un-tick the journaling activity for that day.
      await Promise.all(journalActivityIds.map((activityId) => api.post("/api/routines/log", { localDate: date, activityId, completed: false, value: null, details: {} })));
      await invalidate();
      toast.success("Journal entry deleted");
      setConfirmDelete(false);
      onDeleted?.();
    } catch (err) {
      toast.error(err);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {shown.map((p, i) => (
        <Field key={p.id} label={p.text} hint={p.archived ? "This prompt has since been removed or turned off; your answer is kept." : undefined}>
          {(id) => (
            <Textarea
              id={id}
              value={answers[p.id] ?? ""}
              onChange={(e) => changeAnswer(p.id, e.target.value)}
              onBlur={() => void saver.flush()}
              rows={2}
              maxLength={10_000}
              placeholder={i === 0 ? "Write a few words…" : undefined}
              className="min-h-[4.5rem] [field-sizing:content]"
            />
          )}
        </Field>
      ))}
      <Field label={bodyLabel} hint={shown.length === 0 ? "No prompts are turned on for this routine — just write." : undefined}>
        {(id) => (
          <Textarea
            id={id}
            value={body}
            onChange={(e) => changeBody(e.target.value)}
            onBlur={() => void saver.flush()}
            rows={5}
            maxLength={50_000}
            placeholder="Anything on your mind…"
            className="min-h-32 [field-sizing:content]"
          />
        )}
      </Field>
      <div className="flex min-h-8 flex-wrap items-center justify-between gap-2">
        <SaveIndicator status={status} onRetry={() => void saver.flush()} />
        {status === "idle" && <span className="text-xs text-muted">Saves automatically as you write.</span>}
        {allowDelete && savedId && (
          <Button variant="ghost" size="sm" className="text-critical hover:text-critical" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="size-4" aria-hidden /> Delete entry
          </Button>
        )}
      </div>
      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete this entry?">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-fg-2">The prompts and free writing for this day will be permanently deleted, and the journaling activity for that day will be marked as not done.</p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button variant="danger" loading={deleting} onClick={() => void remove()}>
              Delete
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
