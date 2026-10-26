import type { Metadata } from "next";
import { LogFoodView } from "@/views/log-food";

export const metadata: Metadata = { title: "Log food" };

export default async function Page({ searchParams }: PageProps<"/log">) {
  const sp = await searchParams;
  return <LogFoodView initialDate={typeof sp.date === "string" ? sp.date : null} initialText={typeof sp.text === "string" ? sp.text.slice(0, 2000) : null} />;
}
