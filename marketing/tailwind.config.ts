import type { Config } from "tailwindcss";

// Palette + type from Figma "BGP Website v2c".
// Display serif in the design is "NaN Serf A Display" (trial licence) —
// Source Serif 4 stands in until the real font is licensed.
// Body in the design is Acumin Pro Light — Inter stands in (the design
// already uses Inter for card labels).
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        "bgp-cream": "#fcf8f4",
        "bgp-wine": "#7a0202",
        "bgp-red": "#ff1923",
        "bgp-pink": "#e4d8d3",
        "bgp-pink-deep": "#ddcdc6",
        "bgp-grey": "#f1eded",
        "bgp-ink": "#1d1d1b",
        "bgp-line": "#e9e2da",
        // legacy aliases still referenced in a few components
        "bgp-burgundy": "#7a0202",
        "bgp-blush": "#e4d8d3",
        "bgp-stone": "#c9baa5",
        "bgp-paper": "#fcf8f4",
        "bgp-mist": "#f1eded",
      },
      fontFamily: {
        sans: ["Inter", "Acumin Pro", "Helvetica Neue", "Arial", "sans-serif"],
        display: ["Source Serif 4", "NaN Serf A Display", "Georgia", "serif"],
      },
      letterSpacing: {
        widest2: "0.14em",
      },
    },
  },
  plugins: [],
} satisfies Config;
