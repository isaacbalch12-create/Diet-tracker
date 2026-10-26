import type { Metadata } from "next";
import { HistoryView } from "@/views/history";

export const metadata: Metadata = { title: "Nutrition history" };

export default function Page() {
  return <HistoryView />;
}
