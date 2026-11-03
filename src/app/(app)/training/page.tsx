import type { Metadata } from "next";
import { TrainingHubView } from "@/views/training/hub";

export const metadata: Metadata = { title: "Training" };

export default async function Page({ searchParams }: PageProps<"/training">) {
  const sp = await searchParams;
  return <TrainingHubView start={typeof sp.start === "string" ? sp.start : null} />;
}
