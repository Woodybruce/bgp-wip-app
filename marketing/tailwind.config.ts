import type { Config } from "tailwindcss";

// Palette + type per the BGP Brand Guidelines v1.0 (August 2026):
// four colours only — Bordeaux #6E0C25, Nectar #FC9F8D, Stone #C2BAA3,
// Feather #F8F9EE (body copy black). Headlines Century Gothic Pro Bold,
// upper case, letter spacing -30, line height 100% (Adobe Fonts kit
// use.typekit.net/nan4etq.css — add the family there; Jost from Google
// Fonts stands in until it is). Body and labels Lato, line height 120%.
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        "bgp-cream": "#f8f9ee", // Feather
        "bgp-wine": "#6e0c25", // Bordeaux
        "bgp-nectar": "#fc9f8d",
        "bgp-stone": "#c2baa3",
        "bgp-ink": "#000000", // body copy is black in the guidelines
        // tints of Stone for bands, rules and quiet surfaces
        "bgp-pink": "#c2baa3",
        "bgp-pink-deep": "#b3aa90",
        "bgp-grey": "#e8e4d8",
        "bgp-line": "#dad5c6",
        "bgp-mist": "#eeebe2",
        // legacy aliases still referenced in a few components
        "bgp-red": "#6e0c25", // retired: the red accent is not in the palette
        "bgp-burgundy": "#6e0c25",
        "bgp-blush": "#c2baa3",
        "bgp-paper": "#f8f9ee",
      },
      fontFamily: {
        sans: ["Lato", "Helvetica Neue", "Arial", "sans-serif"],
        // Adobe Fonts serves the family as "century-gothic" (web project nan4etq)
        display: ["century-gothic", "century-gothic-pro", "Century Gothic", "Jost", "Futura", "sans-serif"],
      },
      // Body line height 120% per the guidelines; headlines are leading-none.
      fontSize: {
        xs: ["0.75rem", { lineHeight: "1.2" }],
        sm: ["0.875rem", { lineHeight: "1.2" }],
        base: ["1rem", { lineHeight: "1.2" }],
        lg: ["1.125rem", { lineHeight: "1.2" }],
        xl: ["1.25rem", { lineHeight: "1.2" }],
        "2xl": ["1.5rem", { lineHeight: "1.2" }],
        "3xl": ["1.875rem", { lineHeight: "1.1" }],
        "4xl": ["2.25rem", { lineHeight: "1.1" }],
      },
      letterSpacing: {
        widest2: "0.14em",
      },
    },
  },
  plugins: [],
} satisfies Config;
