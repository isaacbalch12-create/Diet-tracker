import type { Metadata } from "next";
import { JournalView } from "@/views/routines/journal";

export const metadata: Metadata = { title: "Journal" };

export default async function Page({ searchParams }: PageProps<"/journal">) {
  const sp = await searchParams;
  return <JournalView date={typeof sp.date === "string" ? sp.date : null} new={typeof sp.new === "string" ? sp.new : null} />;
}
