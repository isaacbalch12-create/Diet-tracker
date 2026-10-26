import { DashboardView } from "@/views/dashboard";

export default async function Page({ searchParams }: PageProps<"/">) {
  const sp = await searchParams;
  return <DashboardView initialDate={typeof sp.date === "string" ? sp.date : null} />;
}
