import type { Metadata } from "next";
import { RecordsView } from "@/views/training/records";

export const metadata: Metadata = { title: "Personal records" };

export default function Page() {
  return <RecordsView />;
}
