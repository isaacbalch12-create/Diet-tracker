import type { Metadata } from "next";
import { WorkoutEditorView } from "@/views/training/workout-editor";

export const metadata: Metadata = { title: "Workout" };

export default async function Page({ params }: PageProps<"/training/workouts/[id]">) {
  const { id } = await params;
  return <WorkoutEditorView id={decodeURIComponent(id)} />;
}
