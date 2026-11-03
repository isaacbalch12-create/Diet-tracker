import type { Metadata } from "next";
import { GoalsView } from "@/views/goals/goals";

export const metadata: Metadata = { title: "Goals" };

export default async function Page({ searchParams }: PageProps<"/goals">) {
  const sp = await searchParams;
  return <GoalsView new={typeof sp.new === "string" ? sp.new : null} />;
}
