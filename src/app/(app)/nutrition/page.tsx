import type { Metadata } from "next";
import { DashboardView } from "@/views/dashboard";

export const metadata: Metadata = { title: "Food today" };

export default async function Page({ searchParams }: PageProps<"/nutrition">) {
  const sp = await searchParams;
  return <DashboardView initialDate={typeof sp.date === "string" ? sp.date : null} />;
}
