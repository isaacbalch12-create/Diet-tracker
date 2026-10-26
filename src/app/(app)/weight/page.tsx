import type { Metadata } from "next";
import { WeightView } from "@/views/weight";

export const metadata: Metadata = { title: "Weight" };

export default function Page() {
  return <WeightView />;
}
