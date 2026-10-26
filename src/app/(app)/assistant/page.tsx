import type { Metadata } from "next";
import { AssistantView } from "@/views/assistant";

export const metadata: Metadata = { title: "Assistant" };

export default function Page() {
  return <AssistantView />;
}
