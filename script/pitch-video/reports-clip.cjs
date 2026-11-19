// Makes the one clip of the film's "Reporting to the board" section, to the
// words: two takes of the Reports page (film.cjs reportsPick and reportsOut)
// with the board deck's slides between them and its title slide at the end.
// The cut list gives when each phrase is spoken (CUES); voice-cut.cjs plays
// the clip as it is (an "exact" clip).
//
//   CUES=<reports-cues.json> OUT_DIR=<clips folder with reportsPick.webm, reportsOut.webm and film.log> \
//     DECK=<board deck .pdf> [MARK="Illustration"] node script/pitch-video/reports-clip.cjs
//
// The slides are the deck's own pages (pdftoppm), set in a frame that leaves
// the right edge and the foot clear for the presenter and the captions. MARK
// is written on every frame that shows the deck (the figures filmed were
// staged on the demo copy). Nothing here reads the app.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const { CUES, OUT_DIR: OUT, DECK } = process.env;
for (const [name, file] of [["CUES", CUES], ["OUT_DIR", OUT], ["DECK", DECK]]) if (!file || !fs.existsSync(file)) { console.error(`${name} not found`); process.exit(1); }
const MARK = process.env.MARK ?? "Illustration";
const FPS = 25, FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";
const cue = JSON.parse(fs.readFileSync(CUES, "utf8"));
const log = fs.readFileSync(path.join(OUT, "film.log"), "utf8");
const trimOf = name => { const m = [...log.matchAll(new RegExp(`^${name} trim ([0-9.]+) length ([0-9.]+)`, "gm"))].pop(); if (!m) throw new Error(`no film.log line for ${name}`); return +m[1]; };
const tmp = path.join(OUT, ".reports-parts"); fs.mkdirSync(tmp, { recursive: true });
const ff = args => execFileSync("ffmpeg", ["-v", "error", "-y", ...args], { stdio: ["ignore", "inherit", "inherit"] });
const V = ["-an", "-c:v", "libx264", "-preset", "medium", "-crf", "15", "-pix_fmt", "yuv420p", "-r", String(FPS)];

// The slide frame: 1560 x 878 at (36, 26) on the film's dark ground.
const BOX = { w: 1560, h: 878, x: 36, y: 26 }, GROUND = "0x1c1917";
const mark = MARK ? `,drawtext=fontfile=${FONT}:text='${MARK}':fontcolor=white:fontsize=24:x=w-text_w-40:y=36:box=1:boxcolor=0xB8622F@0.9:boxborderw=10` : "";
const pages = path.join(tmp, "page");
execFileSync("pdftoppm", ["-r", "288", "-png", DECK, pages]);      // 3840 x 2160 a page
const page = n => { const f = fs.readdirSync(tmp).filter(x => new RegExp(`^page-0*${n}\\.png$`).test(x))[0]; if (!f) throw new Error(`deck has no page ${n}`); return path.join(tmp, f); };

// Which deck page is which: found by its title, so a deck with more or fewer slides still works.
const titles = execFileSync("pdftotext", ["-layout", DECK, "-"]).toString().split("\f").map(p => (p.split("\n").map(l => l.trim()).find(Boolean) || ""));
const pageOf = (title, nth = 0) => { const hits = titles.map((t, i) => (t.startsWith(title) ? i + 1 : 0)).filter(Boolean); if (!hits[nth]) throw new Error(`no slide titled ${title}`); return hits[nth]; };

const parts = [];
const add = (name, secs, inputs, filter) => {
  const file = path.join(tmp, `${String(parts.length).padStart(2, "0")}-${name}.mp4`);
  ff([...inputs, "-filter_complex", filter, "-map", "[v]", "-t", secs.toFixed(2), ...V, file]);
  parts.push(file); console.log(`${name.padEnd(12)} ${secs.toFixed(2)}s`);
};
// A take of the app, as filmed.
const take = (name, clip, from, secs) => add(name, secs, ["-ss", (trimOf(clip) + from).toFixed(2), "-t", (secs + 0.2).toFixed(2), "-i", path.join(OUT, `${clip}.webm`)],
  `[0:v]fps=${FPS},scale=1920:1080:flags=lanczos,setsar=1,tpad=stop_mode=clone:stop_duration=1[v]`);
// A slide, pushed in a little while it is up. `crop` (fractions of the page: x, y, w, h) shows part of it, larger.
const slide = (name, n, secs, crop) => {
  const frames = Math.ceil(secs * FPS) + 2;
  const pre = crop ? `crop=iw*${crop[2]}:ih*${crop[3]}:iw*${crop[0]}:ih*${crop[1]},scale=${BOX.w * 2}:-2:flags=lanczos,pad=${BOX.w * 2}:${BOX.h * 2}:(ow-iw)/2:(oh-ih)/2:color=white` : `scale=${BOX.w * 2}:${BOX.h * 2}:flags=lanczos`;
  add(name, secs, ["-i", page(n)],
    `[0:v]${pre},zoompan=z='1+0.035*on/${frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${BOX.w}x${BOX.h}:fps=${FPS},pad=1920:1080:${BOX.x}:${BOX.y}:color=${GROUND},setsar=1${mark}[v]`);
};

// 1. The Reports page arrives; the months and the schemes are picked; the Board report card.
take("pick", "reportsPick", 0, cue.lettings);
// 2. "lettings exchanged, Heads of Terms agreed, rental growth and deal speed, scheme by scheme"
const tHots = cue.hots - 0.2, tGrowth = cue.growth - 0.05, tSpeed = cue.speed + 1.15;
slide("headlines", pageOf("Headlines"), tHots - cue.lettings);
slide("activity", pageOf("Letting activity by scheme"), tGrowth - tHots);
slide("growth", pageOf("Rental growth"), tSpeed - tGrowth);
slide("speed", pageOf("Deal speed"), cue.targets - tSpeed);
// 3. "the tenants we are targeting, and how far each one has got"
const tGrid = cue.howfar - 0.15;
slide("targets", pageOf("Target tenants"), tGrid - cue.targets);
slide("inplay", pageOf("Target tenants: in play"), cue.market - tGrid, [0.02, 0.025, 0.70, 0.70]);
// 4. "a market view for each sector of what the industry did that quarter"
const tSections = cue.industry + 0.5;
slide("market", pageOf("Market report"), tSections - cue.market);
slide("sections", pageOf("Market report: by section"), cue.out - tSections);
// 5. "as a PDF or a PowerPoint" on the page, then the deck's own first slide "in your colours, ready to present".
const tTitle = cue.colours + 0.2;
take("out", "reportsOut", 0, tTitle - cue.out);
slide("title", 1, cue.end - tTitle + 0.8);

const list = path.join(tmp, "list.txt"); fs.writeFileSync(list, parts.map(p => `file '${p}'`).join("\n"));
const target = path.join(OUT, "reports.webm");      // named as the other clips are; it is H.264 in a Matroska file
ff(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-f", "matroska", target]);
const length = +execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", target]).toString().trim();
fs.appendFileSync(path.join(OUT, "film.log"), `reports trim 0.00 length ${length.toFixed(1)}\nMADE reports (reports-clip.cjs)\n`);
console.log(`wrote ${target} (${length.toFixed(1)}s for a scene of ${cue.end}s)`);
