import type { Metadata } from "next";
import { HealthConnectView } from "@/views/health/connect";

export const metadata: Metadata = { title: "Connect phone health" };

export default function Page() {
  return <HealthConnectView />;
}
