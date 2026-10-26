import { route } from "@/lib/api";
import { getImage } from "@/lib/services/images";
import { uuidSchema } from "@/lib/validation";

export const GET = route<{ id: string }>(async (_req, { db }, { id }) => {
  const { meta, bytes } = await getImage(db, uuidSchema.parse(id));
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": meta.contentType,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "private, max-age=31536000, immutable",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
});
