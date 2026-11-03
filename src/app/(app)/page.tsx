import { TodayView } from "@/views/today";

export default async function Page({ searchParams }: PageProps<"/">) {
  const sp = await searchParams;
  return <TodayView initialDate={typeof sp.date === "string" ? sp.date : null} />;
}
