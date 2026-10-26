"use client";

import { ArrowLeft, Copy, Pencil, Star, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ItemsEditor } from "@/components/items-editor";
import { NutrientGrid } from "@/components/nutrition";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, CardTitle, ErrorBanner, Field, Input, Select, Skeleton } from "@/components/ui";
import { api, newRequestId } from "@/lib/client/api";
import { useInvalidateData, useMeal, useSettings } from "@/lib/client/hooks";
import { draftFromMealItem, toApiItem } from "@/lib/client/items";
import type { MealJ, SettingsJ } from "@/lib/client/types";
import type { DraftItem } from "@/lib/drafts";
import { fmtTime } from "@/lib/format";
import { formatLocalDate, localParts, logicalDayTimeToInstant } from "@/lib/time";

const SOURCE_LABEL: Record<string, string> = { text: "Described in text (AI)", photo: "Photo (AI)", manual: "Manual / database", saved_meal: "Saved meal", copy: "Copied meal", assistant: "Assistant" };

function Editor({ meal, settings, onDone }: { meal: MealJ; settings: SettingsJ; onDone: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidateData();
  const lp = localParts(new Date(meal.eatenAt), meal.timezone);
  const [items, setItems] = useState<DraftItem[]>(meal.items.map(draftFromMealItem));
  const [title, setTitle] = useState(meal.title);
  const [category, setCategory] = useState(meal.category);
  const [date, setDate] = useState(meal.localDate);
  const [time, setTime] = useState(lp.time);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const cats = settings.mealCategories.includes(category) ? settings.mealCategories : [...settings.mealCategories, category];

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const timeChanged = time !== lp.time || date !== meal.localDate;
      await api.patch(`/api/meals/${meal.id}`, {
        title,
        category,
        items: items.map(toApiItem),
        ...(timeChanged ? { eatenAt: logicalDayTimeToInstant(date, time, meal.timezone, settings.dayStartHour).toISOString(), localDate: date } : {}),
      });
      await invalidate();
      toast.success("Meal updated — totals recalculated");
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <div className="mb-4 flex flex-col gap-3">
        <Field label="Title">{(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Meal">
            {(id) => (
              <Select id={id} value={category} onChange={(e) => setCategory(e.target.value)}>
                {cats.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Date">{(id) => <Input id={id} type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />}</Field>
          <Field label="Time">{(id) => <Input id={id} type="time" value={time} onChange={(e) => e.target.value && setTime(e.target.value)} />}</Field>
        </div>
      </div>
      <ItemsEditor items={items} onChange={setItems} />
      {error ? <div className="mt-3"><ErrorBanner error={error} /></div> : null}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button onClick={save} loading={saving} disabled={items.length === 0}>
          Save changes
        </Button>
      </div>
    </Card>
  );
}

export function MealDetailView({ id }: { id: string }) {
  const router = useRouter();
  const toast = useToast();
  const invalidate = useInvalidateData();
  const settingsQ = useSettings();
  const mealQ = useMeal(id);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  if (mealQ.error) return <ErrorBanner error={mealQ.error} onRetry={() => mealQ.refetch()} />;
  if (!mealQ.data || !settingsQ.data) return <Skeleton className="h-96" />;
  const meal = mealQ.data;
  const settings = settingsQ.data.settings;

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  const duplicate = () =>
    act(async () => {
      const res = await api.post<{ meal: MealJ }>(`/api/meals/${meal.id}/duplicate`, { eatenAt: new Date().toISOString(), clientRequestId: newRequestId() });
      await invalidate();
      toast.success("Copied to now");
      router.push(`/meals/${res.meal.id}`);
    });
  const favorite = () =>
    act(async () => {
      await api.post(`/api/meals/${meal.id}/favorite`, { name: meal.title });
      await invalidate();
      toast.success("Saved to favorites — find it under Log food → Saved");
    });
  const remove = () =>
    act(async () => {
      if (!window.confirm(`Delete “${meal.title}”? This can't be undone.`)) return;
      await api.del(`/api/meals/${meal.id}`);
      await invalidate();
      toast.success("Meal deleted");
      router.push(`/?date=${meal.localDate}`);
    });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <Link href={`/?date=${meal.localDate}`} className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> {formatLocalDate(meal.localDate, { weekday: "long", month: "long", day: "numeric" })}
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-fg">{meal.title}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-fg-2">
            <Badge tone="outline">{meal.category}</Badge>
            <span>{fmtTime(meal.eatenAt, meal.timezone)}</span>
            <span className="text-muted">· {SOURCE_LABEL[meal.source] ?? meal.source}</span>
          </div>
        </div>
        {!editing && (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              <Pencil className="size-4" /> Edit
            </Button>
            <Button variant="secondary" size="sm" onClick={duplicate} disabled={busy}>
              <Copy className="size-4" /> Log again
            </Button>
            <Button variant="secondary" size="sm" onClick={favorite} disabled={busy}>
              <Star className="size-4" /> Save as favorite
            </Button>
            <Button variant="ghost" size="sm" onClick={remove} disabled={busy} aria-label="Delete meal">
              <Trash2 className="size-4" />
            </Button>
          </div>
        )}
      </div>

      {meal.images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {meal.images.map((im) => (
            <a key={im.id} href={im.url} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={im.url} alt="Meal photo" className="h-32 w-32 rounded-lg object-cover sm:h-40 sm:w-40" />
            </a>
          ))}
        </div>
      )}
      {meal.description && (
        <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-fg-2">
          <span className="font-medium text-fg">You wrote: </span>“{meal.description}”
        </p>
      )}
      {meal.notes && <p className="text-sm text-muted">{meal.notes}</p>}

      {editing ? (
        <Editor meal={meal} settings={settings} onDone={() => setEditing(false)} />
      ) : (
        <>
          <Card>
            <CardTitle sub="Amounts and per-food nutrition. Expand a food for every nutrient and its data source.">Foods</CardTitle>
            <ItemsEditor items={meal.items.map(draftFromMealItem)} readOnly />
          </Card>
          <Card>
            <CardTitle sub="Computed from each food's grams × its per-100 g values.">Nutrition</CardTitle>
            <NutrientGrid values={meal.totals.values} incomplete={meal.totals.incomplete} />
          </Card>
        </>
      )}
    </div>
  );
}
