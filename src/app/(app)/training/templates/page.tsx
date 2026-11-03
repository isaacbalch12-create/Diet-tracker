import type { Metadata } from "next";
import { TemplatesView } from "@/views/training/templates";

export const metadata: Metadata = { title: "Workout templates" };

export default function Page() {
  return <TemplatesView />;
}
