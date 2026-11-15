// Cuts the filmed clips into one rough cut for the Landsec pitch video:
// each scene trimmed to where its action starts, the voice lines shown as
// captions (there is no sound yet), and plain cards where Woody and the
// character will go.
//
//   OUT_DIR=<folder with the clips and film.log> node script/pitch-video/assemble.cjs [out.mp4]
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const OUT = process.env.OUT_DIR;
if (!OUT || !fs.existsSync(OUT)) { console.error("OUT_DIR not found"); process.exit(1); }
const target = process.argv[2] || path.join(OUT, "rough-cut.mp4");
const FONT = ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"].find(f => fs.existsSync(f));
const FONT_BOLD = ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"].find(f => fs.existsSync(f)) || FONT;

// The running order. `clip` is a filmed scene; `card` is a placeholder.
const ORDER = [
  { card: "1  Woody to camera", note: "To be filmed on a phone", secs: 9,
    voice: "I'm Woody Bruce from Bruce Gillingham Pollard. You asked, why our agency. Part of the answer is something we've built for you, so let me show you rather than tell you. In fact, I'll get someone else to show you." },
  { card: "2  Woody becomes the character", note: "Character clip from the avatar service", secs: 5,
    voice: "That's better. Mark, this is your login. One place for all fourteen schemes." },
  { clip: "properties", voice: "Every unit, every vacancy and every live letting, counted the same way for your portfolio team, your asset teams, us and the other agents on the panel. Let's take Bluewater." },
  { clip: "unit", voice: "The plan and the tenancy schedule are one thing. Click a unit and everything about it is there. This is Burger King on the lower level: three thousand square feet, with the lease ending in December 2028. Line up what comes next now, and there is no downtime." },
  { clip: "gap", voice: "Differentiation starts with knowing what the competition has. The app tracks who trades at Lakeside, Stratford and Canary Wharf and not at Bluewater, and what those centres are doing each week." },
  { clip: "brand", voice: "And it tracks who is growing. Jersey Mike's: new to the UK, backed by Blackstone, with a stated plan for four hundred sites. A first to market for Bluewater, found on evidence." },
  { clip: "brief", mark: true, voice: "Before anyone picks up the phone, the brief is agreed. Rent, incentives, target brands. Portfolio leasing, the asset manager and us each sign off in our own login." },
  { clip: "offer", mark: true, voice: "Then it runs on the Letting Tracker. An offer comes in and we type it the way we'd say it. The app fills in the form and measures it against the brief." },
  { clip: "hots", mark: true, voice: "Heads of Terms come out on Bluewater's own form, and everyone signs." },
  { clip: "checklist", mark: true, voice: "From Heads of Terms the asset team takes over, with a name against every step. At any moment you can see what the deal is waiting on, and who." },
  { clip: "recommendation", mark: true, max: 31, voice: "The recommendation arrives in your own template, with Net Effective Rent worked out against ERV and the brief." },
  { clip: "calendar", speed: 1, voice: "Viewings, meetings, tasks and the conversation on each property sit in one place, for you and for every agent on the instruction." },
  { card: "11  Woody closes", note: "To be filmed on a phone", secs: 6,
    voice: "That is one unit at one scheme. It runs the same way across all fourteen, so our time goes on brands and deals, not on chasing updates. We'd love to run it with you." },
];

const log = fs.existsSync(path.join(OUT, "film.log")) ? fs.readFileSync(path.join(OUT, "film.log"), "utf8") : "";
const trimOf = name => { const m = [...log.matchAll(new RegExp(`^${name} trim ([0-9.]+) length ([0-9.]+)`, "gm"))].pop(); return m ? { trim: +m[1], length: +m[2] } : null; };
const esc = t => t.replace(/\\/g, "\\\\").replace(/'/g, "\u2019").replace(/:/g, "\\:").replace(/%/g, "\\%").replace(/,/g, "\\,");
const wrap = (text, width) => {
  const lines = []; let line = "";
  for (const w of text.split(/\s+/)) { if ((line + " " + w).trim().length > width) { lines.push(line.trim()); line = w; } else line += " " + w; }
  if (line.trim()) lines.push(line.trim());
  return lines;
};
// The voice line as captions: sentence by sentence, each on screen for its share of the time.
function captions(voice, secs, y0 = 955) {
  const parts = voice.match(/[^.!?]+[.!?]+/g) || [voice];
  const total = parts.reduce((n, p) => n + p.length, 0);
  let t = 0; const out = [];
  for (const p of parts) {
    const d = secs * p.length / total, lines = wrap(p.trim(), 86);
    lines.forEach((l, i) => out.push(`drawtext=fontfile=${FONT}:text='${esc(l)}':fontcolor=white:fontsize=30:x=(w-text_w)/2:y=${y0 + i * 42 - (lines.length - 1) * 21}:box=1:boxcolor=black@0.72:boxborderw=12:enable='between(t\\,${t.toFixed(2)}\\,${(t + d).toFixed(2)})'`));
    t += d;
  }
  return out;
}

const parts = [], tmp = path.join(OUT, ".parts");
fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true });
const ff = args => execFileSync("ffmpeg", ["-v", "error", "-y", ...args], { stdio: "inherit" });
let n = 0, missing = [];
for (const item of ORDER) {
  const file = path.join(tmp, `${String(n++).padStart(2, "0")}.mp4`);
  if (item.card) {
    const vf = [
      `drawtext=fontfile=${FONT_BOLD}:text='${esc(item.card)}':fontcolor=white:fontsize=58:x=(w-text_w)/2:y=400`,
      `drawtext=fontfile=${FONT}:text='${esc(item.note)}':fontcolor=0xE9B48F:fontsize=30:x=(w-text_w)/2:y=500`,
      ...captions(item.voice, item.secs),
    ].join(",");
    ff(["-f", "lavfi", "-i", `color=c=0x1c1917:s=1920x1080:r=25:d=${item.secs}`, "-vf", vf, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", file]);
    parts.push(file); continue;
  }
  const src = path.join(OUT, `${item.clip}.webm`), t = trimOf(item.clip);
  if (!fs.existsSync(src) || !t) { missing.push(item.clip); continue; }
  // Filmed at a careful pace so nothing is missed; played a little faster.
  const speed = item.speed || Number(process.env.SPEED || 1.5);
  const raw = Math.min(item.max || 1e9, Math.max(4, t.length - t.trim - 0.6));
  const secs = raw / speed;
  const vf = [
    `setpts=PTS/${speed}`, "scale=1920:1080:flags=lanczos", "fps=25",
    ...(item.mark ? [`drawtext=fontfile=${FONT}:text='Illustration':fontcolor=white:fontsize=24:x=w-text_w-40:y=36:box=1:boxcolor=0xB8622F@0.9:boxborderw=10`] : []),
    ...captions(item.voice, secs),
  ].join(",");
  ff(["-ss", String(t.trim), "-t", String(raw), "-i", src, "-vf", vf, "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", file]);
  parts.push(file);
}
const listFile = path.join(tmp, "list.txt");
fs.writeFileSync(listFile, parts.map(p => `file '${p}'`).join("\n"));
ff(["-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", target]);
const dur = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", target]).toString().trim();
console.log(`wrote ${target} (${Math.round(dur)}s)${missing.length ? `, scenes not filmed yet: ${missing.join(", ")}` : ""}`);
