import type { Metadata } from "next";
import { AnalyticsView } from "@/views/analytics";

export const metadata: Metadata = { title: "Analytics" };

export default async function Page({ searchParams }: PageProps<"/analytics">) {
  const sp = await searchParams;
  return <AnalyticsView initialTab={typeof sp.tab === "string" ? sp.tab : null} />;
}
