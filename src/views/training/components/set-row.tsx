"use client";

import { Check, MessageSquareText, Trophy } from "lucide-react";
import { memo, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import { cx } from "@/components/ui";
import type { Unit } from "@/lib/training/types";
import { displayWeight, formatLift, parseNumberInput, toKg } from "@/lib/training/units";
import { LIMITS, type EditorSet, type PrevSet } from "./workout-doc";

/**
 * Column layout shared by the header row and every set row. At 375px the card
 * leaves ~311px; with RPE on, the "previous" column moves into the placeholders.
 */
export const SET_GRID = "grid grid-cols-[2.25rem_minmax(0,1fr)_4.5rem_3.5rem_2.75rem] items-center gap-1.5 sm:grid-cols-[2.75rem_minmax(0,1fr)_6rem_5rem_3rem] sm:gap-2";
export const SET_GRID_RPE = "grid grid-cols-[2.25rem_minmax(4rem,1fr)_3.5rem_3rem_2.75rem] items-center gap-1.5 sm:grid-cols-[2.75rem_minmax(0,1fr)_6rem_5rem_4rem_3rem] sm:gap-2";

type Parsed = number | null | "invalid";

function parseWeight(text: string, unit: Unit): Parsed {
  if (!text.trim()) return null;
  const v = parseNumberInput(text);
  if (v == null || v < 0 || toKg(v, unit) > LIMITS.maxWeightKg) return "invalid";
  return v;
}
function parseReps(text: string): Parsed {
  if (!text.trim()) return null;
  const v = parseNumberInput(text);
  if (v == null || !Number.isInteger(v) || v < 0 || v > LIMITS.maxReps) return "invalid";
  return v;
}
function parseRpe(text: string): Parsed {
  if (!text.trim()) return null;
  const v = parseNumberInput(text);
  if (v == null || v < LIMITS.minRpe || v > LIMITS.maxRpe || (v * 2) % 1 !== 0) return "invalid";
  return v;
}

const show = (n: number | null) => (n == null ? "" : String(n));

export interface SetRowProps {
  weId: string;
  set: EditorSet;
  label: string;
  unit: Unit;
  showRpe: boolean;
  prev: PrevSet | null;
  isRecord: boolean;
  onPatch: (weId: string, setId: string, patch: Partial<EditorSet>) => void;
  onToggle: (weId: string, setId: string, prev: PrevSet | null) => void;
  onMenu: (weId: string, setId: string) => void;
  onMessage: (kind: "error" | "info", message: string) => void;
}

export const SetRow = memo(function SetRow({ weId, set, label, unit, showRpe, prev, isRecord, onPatch, onToggle, onMenu, onMessage }: SetRowProps) {
  // Drafts hold raw text while typing ("62.", "8,5"); null means "show the saved value".
  const [wDraft, setWDraft] = useState<string | null>(null);
  const [rDraft, setRDraft] = useState<string | null>(null);
  const [pDraft, setPDraft] = useState<string | null>(null);
  const repsRef = useRef<HTMLInputElement>(null);
  const rpeRef = useRef<HTMLInputElement>(null);

  const savedWeight = displayWeight(set.weightKg, unit);
  const wText = wDraft ?? show(savedWeight);
  const rText = rDraft ?? show(set.reps);
  const pText = pDraft ?? show(set.rpe);
  const wBad = parseWeight(wText, unit) === "invalid";
  const rBad = parseReps(rText) === "invalid";
  const pBad = parseRpe(pText) === "invalid";

  const who = set.kind === "warmup" ? "Warm-up set" : `Set ${label}`;
  const hintWeight = prev?.weightKg ?? set.targetWeightKg;
  const hintReps = prev?.reps ?? set.targetReps;
  const weightPh = hintWeight != null ? formatLift(hintWeight, unit, { withUnit: false }) : unit;
  const repsPh = hintReps != null ? String(hintReps) : "reps";

  const changeWeight = (text: string) => {
    setWDraft(text);
    const v = parseWeight(text, unit);
    if (v === "invalid" || (v == null && set.completed)) return; // resolved on blur
    if (v != null && v === savedWeight) return; // same displayed number: keep exact kg
    onPatch(weId, set.id, { weightKg: v == null ? null : toKg(v, unit) });
  };
  const blurWeight = () => {
    const v = parseWeight(wText, unit);
    setWDraft(null);
    if (v === "invalid") return onMessage("error", `Weight must be a number from 0 to ${formatLift(LIMITS.maxWeightKg, unit)} (0 = bodyweight).`);
    if (v == null && set.completed) {
      onPatch(weId, set.id, { weightKg: null, completed: false });
      onMessage("info", `${who} unticked — a completed set needs a weight (use 0 for bodyweight).`);
    }
  };

  const changeReps = (text: string) => {
    setRDraft(text);
    const v = parseReps(text);
    if (v === "invalid" || ((v == null || v < 1) && set.completed)) return;
    if (v !== set.reps) onPatch(weId, set.id, { reps: v });
  };
  const blurReps = () => {
    const v = parseReps(rText);
    setRDraft(null);
    if (v === "invalid") return onMessage("error", `Reps must be a whole number from 0 to ${LIMITS.maxReps.toLocaleString()}.`);
    if ((v == null || v < 1) && set.completed) {
      onPatch(weId, set.id, { reps: v, completed: false });
      onMessage("info", `${who} unticked — a completed set needs at least 1 rep.`);
    }
  };

  const changeRpe = (text: string) => {
    setPDraft(text);
    const v = parseRpe(text);
    if (v !== "invalid" && v !== set.rpe) onPatch(weId, set.id, { rpe: v });
  };
  const blurRpe = () => {
    const bad = parseRpe(pText) === "invalid";
    setPDraft(null);
    if (bad) onMessage("error", "RPE is 1–10 in half steps (e.g. 8 or 8.5).");
  };

  const toggle = () => {
    if (!set.completed && (wBad || rBad || pBad)) return onMessage("error", `Check ${who.toLowerCase()} — one of the numbers isn't valid.`);
    onToggle(weId, set.id, prev);
  };

  const prevText =
    prev && prev.weightKg != null && prev.reps != null
      ? `${formatLift(prev.weightKg, unit, { withUnit: false })} × ${prev.reps}`
      : set.targetReps != null || set.targetWeightKg != null
        ? `Target ${set.targetWeightKg != null ? formatLift(set.targetWeightKg, unit, { withUnit: false }) : "—"} × ${set.targetReps ?? "—"}`
        : "—";
  const canCopy = !set.completed && prev != null && prev.weightKg != null && prev.reps != null;

  const selectAll = (e: FocusEvent<HTMLInputElement>) => e.currentTarget.select();
  const onEnter = (next?: HTMLInputElement | null) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (next) next.focus();
    else e.currentTarget.blur();
  };

  const inputCls = (bad: boolean) =>
    cx(
      "h-10 w-full min-w-0 rounded-lg border bg-surface-2 px-1 text-center text-base font-semibold text-fg tabular placeholder:font-normal placeholder:text-muted focus:border-accent focus:bg-surface focus:ring-2 focus:ring-accent/25 focus:outline-none sm:h-11",
      bad ? "border-critical" : "border-transparent",
      set.completed && "bg-transparent",
    );

  return (
    <div className={cx(showRpe ? SET_GRID_RPE : SET_GRID, "rounded-lg px-1 py-1 transition-colors", set.completed && "bg-good-soft")}>
      <button
        type="button"
        onClick={() => onMenu(weId, set.id)}
        aria-label={`${who} options${set.notes ? " (has a note)" : ""}${isRecord ? " (record)" : ""}`}
        className={cx("relative flex h-10 items-center justify-center rounded-lg text-sm font-semibold tabular hover:bg-surface-3 sm:h-11", set.kind === "warmup" ? "text-warning-text" : "text-fg-2")}
      >
        {label}
        {isRecord && <Trophy className="absolute -top-0.5 -right-0.5 size-3.5 text-warning" aria-hidden />}
        {set.notes && <MessageSquareText className="absolute -right-0.5 -bottom-0.5 size-3 text-muted" aria-hidden />}
      </button>
      <button
        type="button"
        onClick={() => canCopy && onPatch(weId, set.id, { weightKg: prev!.weightKg, reps: prev!.reps })}
        disabled={!canCopy}
        title={canCopy ? "Copy last time's numbers" : undefined}
        aria-label={canCopy ? `${who}: copy last time's ${prevText}` : `${who} last time: ${prevText}`}
        className={cx("h-10 min-w-0 truncate rounded-lg px-1 text-left text-xs font-medium text-muted tabular enabled:hover:bg-surface-3 enabled:hover:text-fg", showRpe && "hidden sm:block")}
      >
        {prevText}
      </button>
      <input
        className={inputCls(wBad)}
        inputMode="decimal"
        enterKeyHint="next"
        autoComplete="off"
        aria-label={`${who} weight (${unit})`}
        aria-invalid={wBad}
        placeholder={weightPh}
        value={wText}
        onFocus={selectAll}
        onChange={(e) => changeWeight(e.target.value)}
        onBlur={blurWeight}
        onKeyDown={(e) => onEnter(repsRef.current)(e)}
      />
      <input
        ref={repsRef}
        className={inputCls(rBad)}
        inputMode="numeric"
        enterKeyHint={showRpe ? "next" : "done"}
        autoComplete="off"
        aria-label={`${who} reps`}
        aria-invalid={rBad}
        placeholder={repsPh}
        value={rText}
        onFocus={selectAll}
        onChange={(e) => changeReps(e.target.value)}
        onBlur={blurReps}
        onKeyDown={(e) => onEnter(showRpe ? rpeRef.current : null)(e)}
      />
      {showRpe && (
        <input
          ref={rpeRef}
          className={inputCls(pBad)}
          inputMode="decimal"
          enterKeyHint="done"
          autoComplete="off"
          aria-label={`${who} RPE (1–10)`}
          aria-invalid={pBad}
          placeholder="RPE"
          value={pText}
          onFocus={selectAll}
          onChange={(e) => changeRpe(e.target.value)}
          onBlur={blurRpe}
          onKeyDown={(e) => onEnter(null)(e)}
        />
      )}
      <button
        type="button"
        onClick={toggle}
        aria-pressed={set.completed}
        aria-label={set.completed ? `Mark ${who.toLowerCase()} not done` : `Complete ${who.toLowerCase()}`}
        className={cx("flex h-10 items-center justify-center rounded-lg transition active:scale-95 sm:h-11", set.completed ? "bg-good text-white" : "bg-surface-3 text-muted hover:text-fg")}
      >
        <Check className="size-5" strokeWidth={3} aria-hidden />
      </button>
    </div>
  );
});
