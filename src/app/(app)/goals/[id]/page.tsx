import type { Metadata } from "next";
import { GoalDetailView } from "@/views/goals/goal-detail";

export const metadata: Metadata = { title: "Goal" };

export default async function Page({ params }: PageProps<"/goals/[id]">) {
  const { id } = await params;
  return <GoalDetailView id={decodeURIComponent(id)} />;
}
