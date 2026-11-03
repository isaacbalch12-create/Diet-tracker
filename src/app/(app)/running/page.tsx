import type { Metadata } from "next";
import { RunningView } from "@/views/running/running";

export const metadata: Metadata = { title: "Running" };

export default async function Page({ searchParams }: PageProps<"/running">) {
  const sp = await searchParams;
  return <RunningView log={typeof sp.log === "string" ? sp.log : null} />;
}
