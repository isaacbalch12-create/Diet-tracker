"use client";

import { Camera, Clock, Database, ImagePlus, Loader2, MessageSquareText, RotateCcw, Sparkles, Star, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { FoodResults } from "@/components/food-search";
import { ItemsEditor } from "@/components/items-editor";
import { MacroLine } from "@/components/nutrition";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, CardTitle, cx, ErrorBanner, Field, Input, Segmented, Select, Spinner, Textarea } from "@/components/ui";
import { api, ApiError, newRequestId, preparePhoto } from "@/lib/client/api";
import { useInvalidateData, useRecentMeals, useSavedMeals, useSettings } from "@/lib/client/hooks";
import { itemFromFood, toApiItem } from "@/lib/client/items";
import type { AnalysisView, MealJ, SettingsJ } from "@/lib/client/types";
import type { DraftItem, MealDraft } from "@/lib/drafts";
import { isLocalDate, localParts, logicalDayTimeToInstant } from "@/lib/time";

type Mode = "describe" | "photo" | "search" | "saved";

const EXAMPLES = [
  "2 eggs, 3 slices of bacon, 2 pieces of toast with butter, and a glass of orange juice",
  "Chipotle chicken burrito bowl with rice, black beans, salsa and cheese",
  "Greek yogurt with a handful of blueberries and a drizzle of honey",
];

function defaultCategory(categories: string[], hour: number): string {
  const pick = (name: string) => categories.find((c) => c.toLowerCase() === name) ?? null;
  const guess = hour < 4 ? "snack" : hour < 11 ? "breakfast" : hour < 15 ? "lunch" : hour < 17 ? "snack" : hour < 22 ? "dinner" : "snack";
  return pick(guess) ?? categories[0] ?? "Snack";
}

interface UploadedPhoto {
  id: string;
  url: string;
  name: string;
}

function useMealTime(settings: SettingsJ, today: string, initialDate: string | null) {
  const now = localParts(new Date(), settings.timezone);
  const [date, setDate] = useState(initialDate && isLocalDate(initialDate) && initialDate <= today ? initialDate : today);
  const [time, setTime] = useState(now.time);
  const eatenAt = () => logicalDayTimeToInstant(date, time, settings.timezone, settings.dayStartHour).toISOString();
  return { date, setDate, time, setTime, eatenAt, hour: Number(time.slice(0, 2)) };
}

function PhotoPicker({ photos, setPhotos, disabled }: { photos: UploadedPhoto[]; setPhotos: (p: UploadedPhoto[]) => void; disabled?: boolean }) {
  const toast = useToast();
  const [uploading, setUploading] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const room = 4 - photos.length;
    const list = [...files].slice(0, room);
    if (files.length > room) toast.info("Up to 4 photos per meal.");
    setUploading(list.length);
    const added: UploadedPhoto[] = [];
    for (const f of list) {
      try {
        const blob = await preparePhoto(f);
        const form = new FormData();
        form.append("file", blob, f.name.replace(/\.\w+$/, ".jpg"));
        const res = await api.upload<{ images: { id: string; url: string }[] }>("/api/images", form);
        added.push({ ...res.images[0], name: f.name });
      } catch (err) {
        toast.error(err);
      } finally {
        setUploading((n) => n - 1);
      }
    }
    setPhotos([...photos, ...added]);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => camRef.current?.click()} disabled={disabled || photos.length >= 4}>
          <Camera className="size-4" /> Take photo
        </Button>
        <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={disabled || photos.length >= 4}>
          <ImagePlus className="size-4" /> Choose photos
        </Button>
        <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onFiles(e.target.files).finally(() => (e.target.value = ""))} />
        <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => onFiles(e.target.files).finally(() => (e.target.value = ""))} />
      </div>
      {(photos.length > 0 || uploading > 0) && (
        <ul className="flex flex-wrap gap-2">
          {photos.map((p) => (
            <li key={p.id} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt={`Meal photo ${p.name}`} className="size-24 rounded-lg object-cover" />
              <button type="button" aria-label="Remove photo" onClick={() => setPhotos(photos.filter((x) => x.id !== p.id))} className="absolute -top-2 -right-2 flex size-6 items-center justify-center rounded-full bg-fg text-bg">
                <X className="size-3.5" />
              </button>
            </li>
          ))}
          {Array.from({ length: uploading }).map((_, i) => (
            <li key={`u${i}`} className="flex size-24 items-center justify-center rounded-lg bg-surface-2">
              <Loader2 className="size-5 animate-spin text-muted" aria-label="Uploading" />
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted">Photos are resized on your device and stored privately. Add a second angle if portions are hard to judge.</p>
    </div>
  );
}

function Questions({ draft, busy, onSubmit }: { draft: MealDraft; busy: boolean; onSubmit: (answers: { question: string; answer: string }[], note: string) => void }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  if (draft.questions.length === 0) return null;
  const filled = draft.questions.filter((q) => answers[q.id]?.trim()).map((q) => ({ question: q.question, answer: answers[q.id].trim() }));
  return (
    <Card className="border-accent/40">
      <CardTitle sub="Answering improves the estimate. You can also skip and edit foods directly.">
        <span className="inline-flex items-center gap-2">
          <MessageSquareText className="size-4 text-accent" /> A few quick questions
        </span>
      </CardTitle>
      <div className="flex flex-col gap-4">
        {draft.questions.map((q) => (
          <div key={q.id} className="flex flex-col gap-2">
            <p className="text-sm font-medium text-fg">{q.question}</p>
            <div className="flex flex-wrap gap-2">
              {q.options.map((o) => (
                <button
                  key={o}
                  type="button"
                  onClick={() => setAnswers({ ...answers, [q.id]: o })}
                  aria-pressed={answers[q.id] === o}
                  className={cx("rounded-full border px-3 py-1 text-sm", answers[q.id] === o ? "border-accent bg-accent-soft text-accent" : "border-line-strong text-fg-2 hover:bg-surface-2")}
                >
                  {o}
                </button>
              ))}
              <Input aria-label={`Other answer to: ${q.question}`} placeholder="Other…" className="h-8 w-40" value={q.options.includes(answers[q.id] ?? "") ? "" : (answers[q.id] ?? "")} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} />
            </div>
          </div>
        ))}
        <Input aria-label="Anything else to correct" placeholder="Anything else to correct? (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        <div>
          <Button onClick={() => onSubmit(filled, note)} loading={busy} disabled={filled.length === 0 && !note.trim()}>
            <Sparkles className="size-4" /> Update estimate
          </Button>
        </div>
      </div>
    </Card>
  );
}

function SavedAndRecent({ eatenAt, category, onLogged }: { eatenAt: () => string; category: string; onLogged: () => void }) {
  const saved = useSavedMeals();
  const recent = useRecentMeals();
  const toast = useToast();
  const invalidate = useInvalidateData();
  const [busy, setBusy] = useState<string | null>(null);

  const logSaved = async (id: string, servings: number) => {
    setBusy(id);
    try {
      await api.post(`/api/saved-meals/${id}/log`, { eatenAt: eatenAt(), category, servings, clientRequestId: newRequestId() });
      await invalidate();
      toast.success("Meal logged");
      onLogged();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };
  const logAgain = async (m: MealJ) => {
    setBusy(m.id);
    try {
      await api.post(`/api/meals/${m.id}/duplicate`, { eatenAt: eatenAt(), category, clientRequestId: newRequestId() });
      await invalidate();
      toast.success(`Logged “${m.title}”`);
      onLogged();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };
  const removeSaved = async (id: string) => {
    if (!window.confirm("Remove this saved meal? Meals already logged are not affected.")) return;
    try {
      await api.del(`/api/saved-meals/${id}`);
      await saved.refetch();
    } catch (err) {
      toast.error(err);
    }
  };
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted">Logs instantly using the meal type, date and time above.</p>
      <section>
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-fg">
          <Star className="size-4" /> Saved meals
        </h3>
        {saved.isLoading ? (
          <Spinner />
        ) : saved.error ? (
          <ErrorBanner error={saved.error} />
        ) : saved.data!.length === 0 ? (
          <p className="text-sm text-muted">No saved meals yet. Open any logged meal and choose “Save as favorite”.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
            {saved.data!.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-fg">{s.name}</p>
                  <MacroLine values={s.totals.values} incomplete={s.totals.incomplete} />
                </div>
                <div className="flex items-center gap-1">
                  <Button size="sm" onClick={() => logSaved(s.id, 1)} loading={busy === s.id}>
                    Log
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => logSaved(s.id, 2)} disabled={busy === s.id} title="Log two servings">
                    ×2
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => removeSaved(s.id)} aria-label={`Remove saved meal ${s.name}`}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-fg">
          <Clock className="size-4" /> Recent meals
        </h3>
        {recent.isLoading ? (
          <Spinner />
        ) : recent.error ? (
          <ErrorBanner error={recent.error} />
        ) : recent.data!.length === 0 ? (
          <p className="text-sm text-muted">Meals you log will show up here for one-tap re-logging.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
            {recent.data!.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-fg">{m.title}</p>
                  <MacroLine values={m.totals.values} incomplete={m.totals.incomplete} />
                </div>
                <Button size="sm" variant="secondary" onClick={() => logAgain(m)} loading={busy === m.id}>
                  Log again
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export function LogFoodView({ initialDate, initialText }: { initialDate: string | null; initialText: string | null }) {
  const settingsQ = useSettings();
  if (!settingsQ.data) return null;
  return <LogFood settings={settingsQ.data.settings} today={settingsQ.data.today} aiConfigured={settingsQ.data.status.aiConfigured} initialDate={initialDate} initialText={initialText} />;
}

function LogFood({ settings, today, aiConfigured, initialDate, initialText }: { settings: SettingsJ; today: string; aiConfigured: boolean; initialDate: string | null; initialText: string | null }) {
  const router = useRouter();
  const toast = useToast();
  const invalidate = useInvalidateData();
  const time = useMealTime(settings, today, initialDate);
  const [mode, setMode] = useState<Mode>(aiConfigured ? "describe" : "search");
  const [category, setCategory] = useState(() => defaultCategory(settings.mealCategories, time.hour));
  const [text, setText] = useState(initialText ?? "");
  const [photos, setPhotos] = useState<UploadedPhoto[]>([]);
  const [quickSave, setQuickSave] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisView | null>(null);
  const [draft, setDraft] = useState<MealDraft | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState<"analyze" | "refine" | "save" | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [saveFavorite, setSaveFavorite] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const analyzeReq = useRef<string | null>(null);
  const saveReq = useRef<string>(newRequestId());

  // A new input means a new idempotency key; retries of the same input reuse it.
  useEffect(() => {
    analyzeReq.current = null;
  }, [text, photos, mode]);

  const reviewing = draft !== null;
  const backTo = time.date === today ? "/" : `/?date=${time.date}`;

  const startDraft = (d: MealDraft, a: AnalysisView | null) => {
    setDraft(d);
    setAnalysis(a);
    setTitle(d.title);
    if (d.suggestedCategory && settings.mealCategories.includes(d.suggestedCategory) && !reviewing) setCategory(d.suggestedCategory);
    saveReq.current = newRequestId();
  };

  const analyze = async () => {
    setError(null);
    setBusy("analyze");
    analyzeReq.current ??= newRequestId();
    const body = {
      requestId: analyzeReq.current,
      text: text.trim() || null,
      imageIds: mode === "photo" ? photos.map((p) => p.id) : [],
      category,
      eatenAt: time.eatenAt(),
      quickSave,
    };
    try {
      let res: { analysis: AnalysisView; meal: MealJ | null };
      try {
        res = await api.post("/api/analyze", body);
      } catch (err) {
        // The same request is already running (e.g. a double tap): wait for it.
        if (err instanceof ApiError && err.code === "analysis_in_progress") {
          const id = (err.details as { analysisId: string }).analysisId;
          let a: AnalysisView;
          do {
            await new Promise((r) => setTimeout(r, 2000));
            a = (await api.get<{ analysis: AnalysisView }>(`/api/analyze/${id}`)).analysis;
          } while (a.status === "pending");
          if (a.status === "failed") throw new Error(a.error ?? "Analysis failed");
          res = { analysis: a, meal: null };
        } else throw err;
      }
      if (res.meal) {
        await invalidate();
        toast.success(`Saved “${res.meal.title}”`, { label: "Review", onClick: () => router.push(`/meals/${res.meal!.id}`) });
        router.push(backTo);
        return;
      }
      if (!res.analysis.draft) throw new Error("The analysis returned no result.");
      if (res.analysis.status === "confirmed" && res.analysis.mealId) {
        router.push(`/meals/${res.analysis.mealId}`);
        return;
      }
      startDraft(res.analysis.draft, res.analysis);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };

  const refine = async (answers: { question: string; answer: string }[], note: string) => {
    if (!analysis || !draft) return;
    setBusy("refine");
    setError(null);
    try {
      const res = await api.post<{ analysis: AnalysisView }>(`/api/analyze/${analysis.id}/refine`, { answers, note: note || null, currentDraft: { ...draft, title }, eatenAt: time.eatenAt(), category });
      startDraft(res.analysis.draft!, res.analysis);
      toast.success("Estimate updated");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!draft || draft.items.length === 0) return;
    setBusy("save");
    setError(null);
    try {
      const res = await api.post<{ meal: MealJ }>("/api/meals", {
        clientRequestId: saveReq.current,
        eatenAt: time.eatenAt(),
        localDate: time.date,
        category,
        title: title.trim() || draft.title || "Meal",
        description: analysis?.inputText ?? (text.trim() || null),
        source: analysis ? analysis.inputType : "manual",
        analysisId: analysis?.id,
        notes: draft.uncertaintyNotes,
        imageIds: analysis?.imageIds ?? [],
        items: draft.items.map(toApiItem),
      });
      if (saveFavorite) await api.post(`/api/meals/${res.meal.id}/favorite`, { name: res.meal.title }).catch(() => undefined);
      await invalidate();
      toast.success(`Saved “${res.meal.title}”`, { label: "View", onClick: () => router.push(`/meals/${res.meal.id}`) });
      router.push(backTo);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };

  const discard = async () => {
    if (analysis) await api.post(`/api/analyze/${analysis.id}/discard`).catch(() => undefined);
    setDraft(null);
    setAnalysis(null);
    analyzeReq.current = null;
  };

  const setItems = (items: DraftItem[]) => draft && setDraft({ ...draft, items });
  const categories = useMemo(() => (settings.mealCategories.includes(category) ? settings.mealCategories : [...settings.mealCategories, category]), [settings.mealCategories, category]);

  const timeFields = (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <Field label="Meal">
        {(id) => (
          <Select id={id} value={category} onChange={(e) => setCategory(e.target.value)}>
            {categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Date">{(id) => <Input id={id} type="date" value={time.date} max={today} onChange={(e) => e.target.value && time.setDate(e.target.value)} />}</Field>
      <Field label="Time">{(id) => <Input id={id} type="time" value={time.time} onChange={(e) => e.target.value && time.setTime(e.target.value)} />}</Field>
    </div>
  );

  if (reviewing) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">Review meal</h1>
          <Button variant="ghost" onClick={discard}>
            <RotateCcw className="size-4" /> Start over
          </Button>
        </div>
        <p className="text-sm text-muted">Nothing is saved until you press Save. Check portions and fix anything the AI got wrong.</p>
        {error ? <ErrorBanner error={error} /> : null}
        {!draft!.isFood && (
          <div role="alert" className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning-text">
            The AI couldn&apos;t identify food here. Answer the question below, or add foods manually.
          </div>
        )}
        {analysis && analysis.imageIds.length > 0 && (
          <div className="flex gap-2">
            {analysis.imageIds.map((id) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={id} src={`/api/images/${id}`} alt="Meal photo" className="size-20 rounded-lg object-cover" />
            ))}
          </div>
        )}
        <Questions draft={draft!} busy={busy === "refine"} onSubmit={refine} />
        {draft!.uncertaintyNotes && (
          <div className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-fg-2">
            <span className="font-medium text-fg">What&apos;s uncertain: </span>
            {draft!.uncertaintyNotes}
          </div>
        )}
        <Card>
          <div className="mb-4 flex flex-col gap-3">
            <Field label="Title">{(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
            {timeFields}
          </div>
          <CardTitle sub={draft!.model ? "Estimates — check the amounts" : undefined}>Foods</CardTitle>
          <ItemsEditor items={draft!.items} onChange={setItems} />
        </Card>
        <div className="sticky bottom-20 z-20 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface/95 p-3 shadow-lg backdrop-blur md:bottom-4">
          <label className="flex items-center gap-2 text-sm text-fg-2">
            <input type="checkbox" checked={saveFavorite} onChange={(e) => setSaveFavorite(e.target.checked)} className="size-4 accent-[var(--accent)]" />
            Also save as favorite
          </label>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={discard}>
              Discard
            </Button>
            <Button onClick={save} loading={busy === "save"} disabled={draft!.items.length === 0 || busy === "refine"}>
              Save meal
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Log food</h1>
        <Link href={backTo} className="text-sm text-muted hover:text-fg">
          Cancel
        </Link>
      </div>
      <Segmented
        label="How to log"
        value={mode}
        onChange={setMode}
        options={[
          { value: "describe", label: <span className="inline-flex items-center gap-1.5"><Sparkles className="size-3.5" />Describe</span> },
          { value: "photo", label: <span className="inline-flex items-center gap-1.5"><Camera className="size-3.5" />Photo</span> },
          { value: "search", label: <span className="inline-flex items-center gap-1.5"><Database className="size-3.5" />Search</span> },
          { value: "saved", label: <span className="inline-flex items-center gap-1.5"><Star className="size-3.5" />Saved</span> },
        ]}
      />
      <Card>
        <div className="flex flex-col gap-4">
          {timeFields}
          {(mode === "describe" || mode === "photo") && !aiConfigured && (
            <div role="alert" className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning-text">
              AI analysis isn&apos;t configured on this server (missing ANTHROPIC_API_KEY). Use <button className="underline" onClick={() => setMode("search")}>Search</button> to log from the food database instead.
            </div>
          )}
          {mode === "describe" && (
            <>
              <Field label="What did you eat?" hint="Plain English is fine. Include amounts when you know them.">
                {(id) => <Textarea id={id} rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder={EXAMPLES[0]} autoFocus />}
              </Field>
              {!text && (
                <div className="flex flex-wrap gap-2">
                  {EXAMPLES.map((ex) => (
                    <button key={ex} type="button" onClick={() => setText(ex)} className="rounded-full border border-line-strong px-3 py-1 text-left text-xs text-fg-2 hover:bg-surface-2">
                      {ex}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
          {mode === "photo" && (
            <>
              <PhotoPicker photos={photos} setPhotos={setPhotos} disabled={busy !== null} />
              <Field label="Add a note (optional)" hint="e.g. “cooked in olive oil”, “large plate”, “half the rice left”">
                {(id) => <Input id={id} value={text} onChange={(e) => setText(e.target.value)} />}
              </Field>
            </>
          )}
          {(mode === "describe" || mode === "photo") && (
            <>
              <label className="flex items-start gap-2 text-sm text-fg-2">
                <input type="checkbox" checked={quickSave} onChange={(e) => setQuickSave(e.target.checked)} className="mt-0.5 size-4 accent-[var(--accent)]" />
                <span>
                  Quick save — save the AI estimate immediately without reviewing it <span className="text-muted">(you can still edit it later)</span>
                </span>
              </label>
              {error ? <ErrorBanner error={error} onRetry={analyze} /> : null}
              <div className="flex items-center gap-3">
                <Button size="lg" onClick={analyze} loading={busy === "analyze"} disabled={!aiConfigured || (mode === "describe" ? !text.trim() : photos.length === 0)}>
                  <Sparkles className="size-4" /> {quickSave ? "Analyze & save" : "Analyze"}
                </Button>
                {busy === "analyze" && <span className="text-sm text-muted">Identifying foods and matching them to the USDA database…</span>}
              </div>
            </>
          )}
          {mode === "search" && (
            <div className="flex flex-col gap-3">
              <Input aria-label="Search foods" placeholder="Search the USDA food database…" value={searchQ} onChange={(e) => setSearchQ(e.target.value)} autoFocus />
              <FoodResults
                query={searchQ}
                branded={false}
                onPick={(f) => startDraft({ title: f.description.split(",")[0], suggestedCategory: null, items: [itemFromFood(f)], questions: [], uncertaintyNotes: null, isFood: true, model: "" }, null)}
              />
              <p className="text-xs text-muted">Pick a food to start a meal; add more foods or enter label values on the next screen.</p>
            </div>
          )}
          {mode === "saved" && <SavedAndRecent eatenAt={time.eatenAt} category={category} onLogged={() => router.push(backTo)} />}
        </div>
      </Card>
      {mode === "describe" && (
        <p className="text-xs text-muted">
          <Badge tone="accent">How it works</Badge> The AI splits your description into foods and estimates amounts; calories and nutrients come from the USDA database wherever a match exists. You review everything before it&apos;s saved.
        </p>
      )}
    </div>
  );
}
