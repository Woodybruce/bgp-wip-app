import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        "bgp-burgundy": "#6c1325",
        "bgp-blush": "#f39d8e",
        "bgp-stone": "#c9baa5",
        "bgp-paper": "#ffffff",
        "bgp-mist": "#f4f1ec",
        "bgp-ink": "#1d1d1b",
        "bgp-line": "#e5e0d8",
      },
      fontFamily: {
        sans: ["Archivo", "Helvetica Neue", "Arial", "sans-serif"],
      },
      letterSpacing: {
        widest2: "0.2em",
      },
    },
  },
  plugins: [],
} satisfies Config;
