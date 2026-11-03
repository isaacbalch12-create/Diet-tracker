import type { Metadata } from "next";
import { ExerciseDetailView } from "@/views/training/exercise-detail";

export const metadata: Metadata = { title: "Exercise" };

export default async function Page({ params }: PageProps<"/training/exercises/[id]">) {
  const { id } = await params;
  return <ExerciseDetailView id={decodeURIComponent(id)} />;
}
