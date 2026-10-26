import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Diet Tracker",
    short_name: "Diet",
    description: "Nutrition, macro and weight tracking with AI food logging",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f6f3",
    theme_color: "#2a78d6",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
