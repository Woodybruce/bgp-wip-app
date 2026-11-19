// Landsec's own logo (the mark above the word, from its website footer):
// white for a navy ground, near-black for a white page. The only logo a
// Landsec report carries (Woody, 2026-11-19: "juts have the landsec logo",
// "not BGP"). A file that cannot be read means no logo: nothing is drawn in
// its place and none is ever typeset.
import fs from "fs";

export function landsecLogoBytes(kind: "light" | "dark"): Uint8Array | null {
  const file = kind === "light" ? "landsec-logo-light.png" : "landsec-logo-dark.png";
  for (const p of [`${process.cwd()}/server/assets/${file}`, `${process.cwd()}/dist/server/assets/${file}`]) {
    try { if (fs.existsSync(p)) return new Uint8Array(fs.readFileSync(p)); } catch {}
  }
  return null;
}

/** The logo's width over its height (516 x 600), for a renderer that cannot measure it. */
export const LANDSEC_LOGO_RATIO = 516 / 600;
