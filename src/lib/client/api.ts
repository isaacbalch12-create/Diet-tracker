/** Browser-side fetch helpers. All errors become ApiError with a readable message. */

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(method: string, url: string, body?: unknown, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body !== undefined && !(body instanceof FormData) ? { "Content-Type": "application/json" } : undefined,
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
      credentials: "same-origin",
      ...init,
    });
  } catch {
    throw new ApiError("Can't reach the server. Check your connection and try again.", 0, "network");
  }
  if (res.status === 401 && typeof window !== "undefined" && !url.startsWith("/api/auth")) {
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = (data as { error?: { message?: string; code?: string; details?: unknown } } | null)?.error;
    throw new ApiError(err?.message ?? `Request failed (${res.status})`, res.status, err?.code ?? "error", err?.details);
  }
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>("GET", url),
  post: <T>(url: string, body?: unknown) => request<T>("POST", url, body ?? {}),
  patch: <T>(url: string, body: unknown) => request<T>("PATCH", url, body),
  del: <T>(url: string) => request<T>("DELETE", url),
  upload: <T>(url: string, form: FormData) => request<T>("POST", url, form),
};

export function newRequestId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Downscale and re-encode a photo in the browser before upload (keeps uploads
 * small and converts HEIC to JPEG on browsers that can decode it, e.g. Safari).
 */
export async function preparePhoto(file: File, maxEdge = 1568): Promise<Blob> {
  if (file.size > 40 * 1024 * 1024) throw new ApiError("That photo is over 40 MB. Choose a smaller image.", 413, "too_large");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    if (/^image\/(jpeg|png|webp|gif)$/.test(file.type) && file.size <= 5 * 1024 * 1024) return file;
    throw new ApiError("This browser can't read that image format. Use a JPEG or PNG photo.", 415, "unsupported_image");
  }
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  if (!blob) throw new ApiError("Couldn't process that photo.", 400, "image_processing");
  return blob;
}
