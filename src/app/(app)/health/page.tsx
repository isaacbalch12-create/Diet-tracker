import type { Metadata } from "next";
import { HealthView } from "@/views/health/health";

export const metadata: Metadata = { title: "Steps & sleep" };

export default async function Page({ searchParams }: PageProps<"/health">) {
  const sp = await searchParams;
  return <HealthView log={typeof sp.log === "string" ? sp.log : null} />;
}
