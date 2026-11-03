import { randomUUID } from "node:crypto";

/** Prefixed text id in the LiftLog style ("w-…", "s-…"), so imported and new records share one id space. */
export function newId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}
