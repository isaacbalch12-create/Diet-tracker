import { createHash } from "node:crypto";
import { and, eq, inArray, isNull, lt } from "drizzle-orm";
import type { DbOrTx } from "../db";
import { mealAnalyses, mealImages, type MealImage } from "../db/schema";
import { env } from "../env";
import { AppError, badRequest, notFound } from "../errors";

/** Claude accepts images up to 5 MB each; the client resizes photos well below this. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGES_PER_MEAL = 4;

export type ImageType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

/** Identify the real image type from magic bytes (never trust the client's Content-Type). */
export function sniffImageType(buf: Uint8Array): ImageType | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return "image/gif";
  if (String.fromCharCode(...buf.slice(0, 4)) === "RIFF" && String.fromCharCode(...buf.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

export function looksLikeHeic(buf: Uint8Array): boolean {
  return buf.length > 12 && String.fromCharCode(...buf.slice(4, 8)) === "ftyp" && /heic|heix|hevc|mif1|msf1/.test(String.fromCharCode(...buf.slice(8, 12)));
}

/** Best-effort pixel dimensions for JPEG/PNG/WebP. */
export function imageDimensions(buf: Uint8Array, type: ImageType): { width: number; height: number } | null {
  try {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    if (type === "image/png") return { width: dv.getUint32(16), height: dv.getUint32(20) };
    if (type === "image/gif") return { width: dv.getUint16(6, true), height: dv.getUint16(8, true) };
    if (type === "image/webp") {
      const chunk = String.fromCharCode(...buf.slice(12, 16));
      if (chunk === "VP8X") return { width: 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16)), height: 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16)) };
      if (chunk === "VP8 ") return { width: dv.getUint16(26, true) & 0x3fff, height: dv.getUint16(28, true) & 0x3fff };
      if (chunk === "VP8L") {
        const b = dv.getUint32(21, true);
        return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
      }
      return null;
    }
    // JPEG: walk segments to the first SOFn marker.
    let off = 2;
    while (off < buf.length - 9) {
      if (buf[off] !== 0xff) return null;
      const marker = buf[off + 1];
      const len = dv.getUint16(off + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: dv.getUint16(off + 5), width: dv.getUint16(off + 7) };
      }
      off += 2 + len;
    }
  } catch {
    // fall through
  }
  return null;
}

async function s3Client() {
  const { AwsClient } = await import("aws4fetch");
  const cfg = env.s3;
  if (!cfg.endpoint || !cfg.bucket || !cfg.accessKeyId || !cfg.secretAccessKey) {
    throw new AppError(500, "storage_misconfigured", "IMAGE_STORAGE=s3 requires S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY.");
  }
  const client = new AwsClient({ accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey, region: cfg.region, service: "s3" });
  const url = (key: string) => `${cfg.endpoint!.replace(/\/$/, "")}/${cfg.bucket}/${key}`;
  return { client, url };
}

export async function saveImage(db: DbOrTx, bytes: Uint8Array): Promise<MealImage> {
  if (bytes.byteLength === 0) throw badRequest("The image file is empty.");
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new AppError(413, "image_too_large", `Image is ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB; the limit is 5 MB. The app normally shrinks photos automatically — try a JPEG or a smaller photo.`);
  }
  const type = sniffImageType(bytes);
  if (!type) {
    if (looksLikeHeic(bytes)) throw new AppError(415, "unsupported_image", "HEIC photos aren't supported by this browser upload. Use JPEG/PNG (on iPhone: Settings → Camera → Formats → Most Compatible), or upload from Safari which converts automatically.");
    throw new AppError(415, "unsupported_image", "Unsupported file type. Upload a JPEG, PNG, WebP or GIF image.");
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const dims = imageDimensions(bytes, type);
  const buffer = Buffer.from(bytes);
  if (env.imageStorage === "s3") {
    const { client, url } = await s3Client();
    const key = `meal-images/${sha256}`;
    const res = await client.fetch(url(key), { method: "PUT", body: buffer, headers: { "Content-Type": type } });
    if (!res.ok) throw new AppError(502, "storage_error", `Image storage upload failed (${res.status}).`);
    const [row] = await db
      .insert(mealImages)
      .values({ contentType: type, byteSize: bytes.byteLength, width: dims?.width, height: dims?.height, sha256, storage: "s3", storageKey: key })
      .returning();
    return row;
  }
  const [row] = await db
    .insert(mealImages)
    .values({ contentType: type, byteSize: bytes.byteLength, width: dims?.width, height: dims?.height, sha256, storage: "db", data: buffer })
    .returning();
  return row;
}

export async function getImage(db: DbOrTx, id: string): Promise<{ meta: MealImage; bytes: Buffer }> {
  const [row] = await db.select().from(mealImages).where(eq(mealImages.id, id));
  if (!row) throw notFound("Image");
  if (row.storage === "db") {
    if (!row.data) throw notFound("Image data");
    return { meta: row, bytes: row.data };
  }
  const { client, url } = await s3Client();
  const res = await client.fetch(url(row.storageKey!));
  if (!res.ok) throw new AppError(502, "storage_error", `Could not load image from storage (${res.status}).`);
  return { meta: row, bytes: Buffer.from(await res.arrayBuffer()) };
}

export async function getImagesForAnalysis(db: DbOrTx, ids: string[]): Promise<{ id: string; contentType: ImageType; base64: string }[]> {
  const out = [];
  for (const id of ids) {
    const { meta, bytes } = await getImage(db, id);
    out.push({ id, contentType: meta.contentType as ImageType, base64: bytes.toString("base64") });
  }
  return out;
}

/** Remove uploads that never became part of a saved meal (abandoned drafts), after 7 days. */
export async function cleanupOrphanImages(db: DbOrTx, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - 7 * 86_400_000);
  const candidates = await db
    .select({ id: mealImages.id })
    .from(mealImages)
    .where(and(isNull(mealImages.mealId), lt(mealImages.createdAt, cutoff)));
  if (candidates.length === 0) return 0;
  // Keep images still referenced by an analysis that is awaiting review.
  const pending = await db.select({ imageIds: mealAnalyses.imageIds }).from(mealAnalyses).where(inArray(mealAnalyses.status, ["pending", "completed"]));
  const keep = new Set(pending.flatMap((p) => p.imageIds));
  const ids = candidates.map((c) => c.id).filter((id) => !keep.has(id));
  if (ids.length === 0) return 0;
  await db.delete(mealImages).where(inArray(mealImages.id, ids));
  return ids.length;
}
