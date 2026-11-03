import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RoutineView } from "@/views/routines/routine";

export const metadata: Metadata = { title: "Routine" };

export default async function Page({ params, searchParams }: PageProps<"/routines/[slot]">) {
  const { slot } = await params;
  const sp = await searchParams;
  if (slot !== "morning" && slot !== "night") notFound();
  return <RoutineView slot={slot} initialDate={typeof sp.date === "string" ? sp.date : null} />;
}
