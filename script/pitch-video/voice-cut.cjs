// Cuts the Landsec pitch film to Woody's recorded voice. One recording (him
// to camera, reading the lines) and a cut list that says, for each scene,
// which stretches of the recording belong to it:
//   - a "camera" item shows the recording itself for those stretches;
//   - a "clip" item plays a filmed app scene under his voice, sped up to fit
//     the line, and never faster than can be followed (it runs on in silence
//     when the scene needs longer than the line).
// The cut list is made from the transcript, with false starts and long
// pauses left out; it is not in the repo with the recording.
//
//   REC=<recording.mp4> CUT=<cutlist.json> OUT_DIR=<folder with the clips and film.log> \
//     node script/pitch-video/voice-cut.cjs [out.mp4]
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const { REC, CUT, OUT_DIR: OUT } = process.env;
for (const [name, file] of [["REC", REC], ["CUT", CUT], ["OUT_DIR", OUT]]) if (!file || !fs.existsSync(file)) { console.error(`${name} not found`); process.exit(1); }
const target = process.argv[2] || path.join(OUT, "voice-cut.mp4");
const items = JSON.parse(fs.readFileSync(CUT, "utf8"));
const CAPTIONS = process.env.CAPTIONS !== "0";
const MAX_SPEED = Number(process.env.MAX_SPEED || 2.6), MAX_PHONE_SPEED = Number(process.env.MAX_PHONE_SPEED || 3.2);
const FONT = ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"].find(f => fs.existsSync(f));
const FONT_BOLD = ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"].find(f => fs.existsSync(f)) || FONT;

const log = fs.existsSync(path.join(OUT, "film.log")) ? fs.readFileSync(path.join(OUT, "film.log"), "utf8") : "";
const trimOf = name => { const m = [...log.matchAll(new RegExp(`^${name} trim ([0-9.]+) length ([0-9.]+)`, "gm"))].pop(); return m ? { trim: +m[1], length: +m[2] } : null; };
const esc = t => t.replace(/\\/g, "\\\\").replace(/'/g, "\u2019").replace(/:/g, "\\:").replace(/%/g, "\\%").replace(/,/g, "\\,");
const wrap = (text, width) => {
  const lines = []; let line = "";
  for (const w of text.split(/\s+/)) { if ((line + " " + w).trim().length > width) { lines.push(line.trim()); line = w; } else line += " " + w; }
  if (line.trim()) lines.push(line.trim());
  return lines;
};
// The line as captions, a sentence at a time, each for its share of the time it is spoken in.
function captions(text, secs, y0 = 955) {
  if (!CAPTIONS || !text) return [];
  const parts = text.match(/[^.!?]+[.!?]+/g) || [text];
  const total = parts.reduce((n, p) => n + p.length, 0);
  let t = 0; const out = [];
  for (const p of parts) {
    const d = secs * p.length / total;
    // A long sentence is shown two lines at a time.
    const lines = wrap(p.trim(), 86), pages = [];
    for (let i = 0; i < lines.length; i += 2) pages.push(lines.slice(i, i + 2));
    const chars = pages.map(pg => pg.join(" ").length), sum = chars.reduce((a, b) => a + b, 0);
    let pt = t;
    pages.forEach((pg, k) => {
      const pd = d * chars[k] / sum;
      pg.forEach((l, i) => out.push(`drawtext=fontfile=${FONT}:text='${esc(l)}':fontcolor=white:fontsize=30:x=(w-text_w)/2:y=${y0 + i * 42 - (pg.length - 1) * 21}:box=1:boxcolor=black@0.72:boxborderw=12:enable='between(t\\,${pt.toFixed(2)}\\,${(pt + pd).toFixed(2)})'`));
      pt += pd;
    });
    t += d;
  }
  return out;
}

const tmp = path.join(OUT, ".voice-parts");
fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true });
const ff = args => execFileSync("ffmpeg", ["-v", "error", "-y", ...args], { stdio: "inherit" });

// The voice, cleaned once for the whole recording so every scene sits at one level.
const voice = path.join(tmp, "voice.wav");
ff(["-i", REC, "-vn", "-af", "highpass=f=85,afftdn=nf=-28,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000", "-ac", "2", voice]);

const parts = [], missing = [];
let n = 0, total = 0;
for (const item of items) {
  const file = path.join(tmp, `${String(n++).padStart(2, "0")}.mp4`);
  const ranges = item.ranges, spoken = ranges.reduce((s, [a, b]) => s + (b - a), 0);
  const audio = ranges.map(([a, b], i) => `[1:a]atrim=start=${a}:end=${b},asetpts=PTS-STARTPTS,afade=t=in:d=0.02,afade=t=out:st=${Math.max(0, b - a - 0.04).toFixed(2)}:d=0.04[a${i}]`).join(";")
    + `;${ranges.map((_, i) => `[a${i}]`).join("")}concat=n=${ranges.length}:v=0:a=1`;
  if (item.kind === "camera") {
    // The recording itself. Each stretch is framed a little differently, so a cut reads as a cut.
    const offset = Math.max(0, ranges[0][0] - 3);
    const video = ranges.map(([a, b], i) => `[0:v]trim=start=${(a - offset).toFixed(2)}:end=${(b - offset).toFixed(2)},setpts=PTS-STARTPTS,fps=25,${i % 2 ? "crop=iw/1.08:ih/1.08:(iw-ow)/2:(ih-oh)*0.35," : ""}scale=1920:1080:flags=lanczos,setsar=1[v${i}]`).join(";")
      + `;${ranges.map((_, i) => `[v${i}]`).join("")}concat=n=${ranges.length}:v=1:a=0[vc]`;
    const draw = [...(item.name === "intro" ? [
      `drawtext=fontfile=${FONT_BOLD}:text='Woody Bruce':fontcolor=white:fontsize=40:x=110:y=820:box=1:boxcolor=0x6E0C25@0.92:boxborderw=14:enable='between(t\\,0.6\\,6)'`,
      `drawtext=fontfile=${FONT}:text='Bruce Gillingham Pollard':fontcolor=white:fontsize=26:x=110:y=884:box=1:boxcolor=black@0.6:boxborderw=10:enable='between(t\\,0.6\\,6)'`] : []),
      ...captions(item.text, spoken)];
    ff(["-ss", String(offset), "-i", REC, "-i", voice, "-filter_complex", `${video};[vc]${draw.length ? draw.join(",") : "null"}[v];${audio}[a]`,
      "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-r", "25", "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2", file]);
    parts.push(file); total += spoken; continue;
  }
  const src = path.join(OUT, `${item.clip}.webm`), t = trimOf(item.clip);
  if (!fs.existsSync(src) || !t) { missing.push(item.clip); continue; }
  const raw = Math.min(item.max || 1e9, Math.max(4, t.length - t.trim - 0.6));
  // Long enough for the line, and for the scene at a pace that can be followed.
  const secs = Math.max(spoken + 0.3, raw / (item.phone ? MAX_PHONE_SPEED : MAX_SPEED));
  const speed = raw / secs;
  const vf = [
    `setpts=PTS/${speed.toFixed(4)}`,
    ...(item.phone ? ["crop=390:844:0:0", "scale=-2:860:flags=lanczos", "pad=1920:1080:(ow-iw)/2:30:color=0x1c1917"] : ["scale=1920:1080:flags=lanczos"]),
    "fps=25", "setsar=1",
    ...(item.mark ? [`drawtext=fontfile=${FONT}:text='Illustration':fontcolor=white:fontsize=24:x=w-text_w-40:y=36:box=1:boxcolor=0xB8622F@0.9:boxborderw=10`] : []),
    ...captions(item.text, spoken),
  ].join(",");
  ff(["-ss", String(t.trim), "-t", String(raw), "-i", src, "-i", voice, "-filter_complex", `[0:v]${vf}[v];${audio},adelay=150|150,apad[a]`,
    "-map", "[v]", "-map", "[a]", "-t", secs.toFixed(2), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-r", "25", "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2", file]);
  parts.push(file); total += secs;
  console.log(`${item.clip.padEnd(15)} line ${spoken.toFixed(1)}s, on screen ${secs.toFixed(1)}s, played at ${speed.toFixed(2)}x`);
}
const listFile = path.join(tmp, "list.txt");
fs.writeFileSync(listFile, parts.map(p => `file '${p}'`).join("\n"));
ff(["-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", "-movflags", "+faststart", target]);
const dur = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", target]).toString().trim();
console.log(`wrote ${target} (${Math.floor(dur / 60)}:${String(Math.round(dur % 60)).padStart(2, "0")})${missing.length ? `, scenes not filmed: ${missing.join(", ")}` : ""}`);
