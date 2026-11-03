import type { Metadata } from "next";
import { WorkoutHistoryView } from "@/views/training/history";

export const metadata: Metadata = { title: "Workout history" };

export default function Page() {
  return <WorkoutHistoryView />;
}
