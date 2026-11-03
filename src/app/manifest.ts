import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Momentum",
    short_name: "Momentum",
    description: "Nutrition, training, daily running, steps, sleep and routines in one place",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f6f3",
    theme_color: "#2a78d6",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
