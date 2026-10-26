import { route } from "@/lib/api";
import { AppError, badRequest } from "@/lib/errors";
import { cleanupOrphanImages, MAX_IMAGES_PER_MEAL, saveImage } from "@/lib/services/images";

export const POST = route(async (req, { db }) => {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw badRequest("Upload must be multipart form data with one or more 'file' fields.");
  }
  const files = form.getAll("file").filter((f): f is File => typeof f !== "string");
  if (files.length === 0) throw badRequest("No image received.");
  if (files.length > MAX_IMAGES_PER_MEAL) throw new AppError(400, "too_many_images", `Upload at most ${MAX_IMAGES_PER_MEAL} photos per meal.`);
  const saved = [];
  for (const f of files) {
    const row = await saveImage(db, new Uint8Array(await f.arrayBuffer()));
    saved.push({ id: row.id, url: `/api/images/${row.id}`, width: row.width, height: row.height, byteSize: row.byteSize });
  }
  // Opportunistic housekeeping of abandoned uploads.
  cleanupOrphanImages(db).catch(() => undefined);
  return Response.json({ images: saved }, { status: 201 });
});
