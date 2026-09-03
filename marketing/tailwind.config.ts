import type { Config } from "tailwindcss";

// Palette + type per BGP Rebrand v19 (the fixed "Serif." route):
// Titles FreightText Pro (Adobe Fonts kit use.typekit.net/nan4etq.css,
// Lora fallback), body Lato Light/Medium (exact, Google Fonts).
// Bordeaux #6e0c25 / Nectar #fc9f8d / Stone #c2baa3.
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        "bgp-cream": "#fcf8f4",
        "bgp-wine": "#6e0c25",
        "bgp-red": "#ff1923",
        "bgp-pink": "#e4d8d3",
        "bgp-pink-deep": "#ddcdc6",
        "bgp-grey": "#f1eded",
        "bgp-ink": "#1d1d1b",
        "bgp-line": "#e9e2da",
        // legacy aliases still referenced in a few components
        "bgp-burgundy": "#6e0c25",
        "bgp-blush": "#e4d8d3",
        "bgp-stone": "#c2baa3",
        "bgp-nectar": "#fc9f8d",
        "bgp-paper": "#fcf8f4",
        "bgp-mist": "#f1eded",
      },
      fontFamily: {
        sans: ["Lato", "Helvetica Neue", "Arial", "sans-serif"],
        display: ["freight-text-pro", "Lora", "Georgia", "serif"],
      },
      letterSpacing: {
        widest2: "0.14em",
      },
    },
  },
  plugins: [],
} satisfies Config;
