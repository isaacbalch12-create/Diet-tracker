"use client";

import { useEffect, useState } from "react";
import { isTransient } from "./put";

export type SaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

/**
 * Debounced saving with at most one request in flight. Edits made while a save
 * is running are queued (only the latest document is kept) and sent as soon as
 * the current request finishes. Offline/server errors retry automatically.
 */
class AutosaveController<T> {
  private latest: { doc: T } | null = null;
  private inFlight: Promise<boolean> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private save: (doc: T) => Promise<void>,
    private readonly onStatus: (status: SaveStatus, error: unknown) => void,
    private readonly delay: number,
  ) {}

  setSave(save: (doc: T) => Promise<void>) {
    this.save = save;
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  schedule(doc: T, delay = this.delay) {
    this.latest = { doc };
    this.onStatus("pending", null);
    this.clearTimer();
    this.timer = setTimeout(() => void this.flush(), delay);
  }

  /** Send anything pending now. Resolves true when everything is saved. */
  flush(): Promise<boolean> {
    this.clearTimer();
    if (this.inFlight) return this.inFlight.then(() => this.flush());
    const next = this.latest;
    if (!next) return Promise.resolve(true);
    this.latest = null;
    this.onStatus("saving", null);
    const p = this.save(next.doc).then(
      () => {
        this.inFlight = null;
        if (this.latest) return this.flush();
        this.onStatus("saved", null);
        return true;
      },
      (err: unknown) => {
        this.inFlight = null;
        if (!this.latest) this.latest = next;
        this.onStatus("error", err);
        if (isTransient(err)) {
          this.clearTimer();
          this.timer = setTimeout(() => void this.flush(), 5000);
        }
        return false;
      },
    );
    this.inFlight = p;
    return p;
  }

  /** Drop pending changes (e.g. the workout is being deleted) and wait for any running save. */
  async cancel(): Promise<void> {
    this.clearTimer();
    this.latest = null;
    if (this.inFlight) await this.inFlight.catch(() => false);
    this.latest = null;
  }

  hasUnsaved(): boolean {
    return this.latest != null || this.inFlight != null;
  }
}

export interface Autosave<T> {
  setSave: (save: (doc: T) => Promise<void>) => void;
  schedule: (doc: T, delay?: number) => void;
  flush: () => Promise<boolean>;
  cancel: () => Promise<void>;
  hasUnsaved: () => boolean;
}

export function useAutosave<T>(save: (doc: T) => Promise<void>, delay = 600): [{ status: SaveStatus; error: unknown }, Autosave<T>] {
  const [state, setState] = useState<{ status: SaveStatus; error: unknown }>({ status: "idle", error: null });
  const [ctl] = useState(() => {
    const c = new AutosaveController<T>(save, (status, error) => setState({ status, error }), delay);
    const api: Autosave<T> = {
      setSave: (fn) => c.setSave(fn),
      schedule: (doc, d) => c.schedule(doc, d),
      flush: () => c.flush(),
      cancel: () => c.cancel(),
      hasUnsaved: () => c.hasUnsaved(),
    };
    return api;
  });
  useEffect(() => {
    ctl.setSave(save);
  });

  useEffect(() => {
    // Phones lock and tabs get backgrounded mid-workout: save right away when hidden.
    const onHide = () => {
      if (document.visibilityState === "hidden") void ctl.flush();
    };
    const onUnload = (e: BeforeUnloadEvent) => {
      if (!ctl.hasUnsaved()) return;
      void ctl.flush();
      e.preventDefault();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("beforeunload", onUnload);
      // Leaving the page within the app: send whatever is pending.
      void ctl.flush();
    };
  }, [ctl]);

  return [state, ctl];
}
