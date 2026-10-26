import type { Metadata } from "next";
import { MealDetailView } from "@/views/meal-detail";

export const metadata: Metadata = { title: "Meal" };

export default async function Page({ params }: PageProps<"/meals/[id]">) {
  const { id } = await params;
  return <MealDetailView id={id} />;
}
