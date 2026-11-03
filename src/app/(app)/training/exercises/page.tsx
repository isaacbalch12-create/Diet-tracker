import type { Metadata } from "next";
import { ExerciseLibraryView } from "@/views/training/library";

export const metadata: Metadata = { title: "Exercises" };

export default function Page() {
  return <ExerciseLibraryView />;
}
