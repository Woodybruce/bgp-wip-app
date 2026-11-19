// Makes the one clip of the film's "Reporting to the board" section, to the
// words: two takes of the Reports page (film.cjs reportsPick and reportsOut)
// with the board deck's slides between them and its title slide at the end.
// The cut list gives when each phrase is spoken (CUES); voice-cut.cjs plays
// the clip as it is (an "exact" clip).
//
//   CUES=<reports-cues.json> OUT_DIR=<clips folder with reportsPick.webm, reportsOut.webm and film.log> \
//     DECK=<board deck .pdf> [MARKET_DECK=<market report deck .pdf>] [MARKET_SECTOR=Hospitality] [MARKET_SECTOR2="London retail"] \
//     [MARK="Illustration"] node script/pitch-video/reports-clip.cjs
//
// The slides are the deck's own pages (pdftoppm), set in a frame that leaves
// the right edge and the foot clear for the presenter and the captions. MARK
// is written on every frame that shows the BOARD deck (the figures filmed were
// staged on the demo copy). With MARKET_DECK the market line is pictured from
// the Market report deck: those slides are real public news and carry no mark.
// When the cues give m1, m2 and m3 (the cut list holds a pause after the market
// line) there are four, each framed close enough to read a headline: the
// Overview, the first "who is doing what" slide of MARKET_SECTOR and of
// MARKET_SECTOR2, and Competition. Without them there are three, as on
// 19 November's first cut. Nothing here reads the app.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const { CUES, OUT_DIR: OUT, DECK, MARKET_DECK } = process.env;
const SECTOR = process.env.MARKET_SECTOR || "Hospitality", SECTOR2 = process.env.MARKET_SECTOR2 || "London retail";
for (const [name, file] of [["CUES", CUES], ["OUT_DIR", OUT], ["DECK", DECK]]) if (!file || !fs.existsSync(file)) { console.error(`${name} not found`); process.exit(1); }
const MARK = process.env.MARK ?? "Illustration";
const FPS = 25, FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";
const cue = JSON.parse(fs.readFileSync(CUES, "utf8"));
const log = fs.readFileSync(path.join(OUT, "film.log"), "utf8");
const trimOf = name => { const m = [...log.matchAll(new RegExp(`^${name} trim ([0-9.]+) length ([0-9.]+)`, "gm"))].pop(); if (!m) throw new Error(`no film.log line for ${name}`); return +m[1]; };
const tmp = fs.mkdtempSync(path.join(OUT, ".reports-parts-"));      // a new folder each run: a page left by an earlier deck is never picked up
const ff = args => execFileSync("ffmpeg", ["-v", "error", "-y", ...args], { stdio: ["ignore", "inherit", "inherit"] });
const V = ["-an", "-c:v", "libx264", "-preset", "medium", "-crf", "15", "-pix_fmt", "yuv420p", "-r", String(FPS)];

// The slide frame: 1560 x 878 at (36, 26) on the film's dark ground.
const BOX = { w: 1560, h: 878, x: 36, y: 26 }, GROUND = "0x1c1917";
const mark = MARK ? `,drawtext=fontfile=${FONT}:text='${MARK}':fontcolor=white:fontsize=24:x=w-text_w-40:y=36:box=1:boxcolor=0xB8622F@0.9:boxborderw=10` : "";
// A deck's pages as pictures, and which page is which: found by its title, so a deck with more or fewer slides still works.
const open = (file, prefix) => {
  execFileSync("pdftoppm", ["-r", "288", "-png", file, path.join(tmp, prefix)]);      // 3840 x 2160 a page
  const titles = execFileSync("pdftotext", ["-layout", file, "-"]).toString().split("\f").map(p => (p.split("\n").map(l => l.trim()).find(Boolean) || ""));
  return {
    page: n => { const f = fs.readdirSync(tmp).filter(x => new RegExp(`^${prefix}-0*${n}\\.png$`).test(x))[0]; if (!f) throw new Error(`${prefix} deck has no page ${n}`); return path.join(tmp, f); },
    // `exact` takes the slide whose title is the words and no more ("Hospitality", not "Hospitality: who is doing what").
    pageOf: (title, exact = false) => { const hit = titles.findIndex(t => (exact ? t === title : t.startsWith(title))); if (hit < 0) throw new Error(`no slide titled ${title} in the ${prefix} deck`); return hit + 1; },
  };
};
const board = open(DECK, "page");
const market = MARKET_DECK ? open(MARKET_DECK, "market") : null;
const page = board.page, pageOf = board.pageOf;

const parts = [];
const add = (name, secs, inputs, filter) => {
  const file = path.join(tmp, `${String(parts.length).padStart(2, "0")}-${name}.mp4`);
  ff([...inputs, "-filter_complex", filter, "-map", "[v]", "-t", secs.toFixed(2), ...V, file]);
  parts.push(file); console.log(`${name.padEnd(12)} ${secs.toFixed(2)}s`);
};
// A take of the app, as filmed. `footage` seconds of it are played (at `speed`) and its last frame is held for the rest.
const take = (name, clip, from, secs, { footage = secs + 0.2, speed = 1 } = {}) => add(name, secs, ["-ss", (trimOf(clip) + from).toFixed(2), "-t", footage.toFixed(2), "-i", path.join(OUT, `${clip}.webm`)],
  `[0:v]setpts=PTS/${speed},fps=${FPS},scale=1920:1080:flags=lanczos,setsar=1,tpad=stop_mode=clone:stop_duration=${Math.max(1, secs - footage / speed + 1).toFixed(2)}[v]`);
// A slide, pushed in a little while it is up. `crop` (fractions of the page: x, y, w, h) shows part of it, larger.
// `to` (x, y, w) starts on the whole slide and moves in to that part of it, then holds there.
const slide = (name, file, secs, crop, marked = true, to = null) => {
  const frames = Math.ceil(secs * FPS) + 2;
  if (to) {
    const n0 = Math.round(0.3 * FPS), n1 = Math.round(1.2 * FPS), Z = 1 / to.w, p = `clip((on-${n0})/${n1 - n0},0,1)`, e = `${p}*${p}*(3-2*${p})`;
    return add(name, secs, ["-i", file],
      `[0:v]scale=${BOX.w * 2}:${BOX.h * 2}:flags=lanczos,zoompan=z='1+${(Z - 1).toFixed(4)}*${e}':x='iw*${to.x}*(1-1/zoom)/${(1 - 1 / Z).toFixed(4)}':y='ih*${to.y}*(1-1/zoom)/${(1 - 1 / Z).toFixed(4)}':d=${frames}:s=${BOX.w}x${BOX.h}:fps=${FPS},pad=1920:1080:${BOX.x}:${BOX.y}:color=${GROUND},setsar=1${marked ? mark : ""}[v]`);
  }
  const pre = crop ? `crop=iw*${crop[2]}:ih*${crop[3]}:iw*${crop[0]}:ih*${crop[1]},scale=${BOX.w * 2}:-2:flags=lanczos,pad=${BOX.w * 2}:${BOX.h * 2}:(ow-iw)/2:(oh-ih)/2:color=white` : `scale=${BOX.w * 2}:${BOX.h * 2}:flags=lanczos`;
  add(name, secs, ["-i", file],
    `[0:v]${pre},zoompan=z='1+0.035*on/${frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${BOX.w}x${BOX.h}:fps=${FPS},pad=1920:1080:${BOX.x}:${BOX.y}:color=${GROUND},setsar=1${marked ? mark : ""}[v]`);
};

// 1. The Reports page arrives; the months and the schemes are picked; the Board report card.
// The take was filmed to an earlier reading of the lines (19 November): the page is still from about 3 s to PICK_STILL,
// the months and a scheme are picked from there to PICK_DONE, then the pointer goes to the Board report card. So the
// still page is held until he says "we pick the months", and the picking is played a little faster, with the words.
const PICK_STILL = 7.9, PICK_DONE = 12.3, PICK_SPEED = 1.6;
const tPick = cue.pick - 0.2, picking = (PICK_DONE - PICK_STILL) / PICK_SPEED;
if (tPick > PICK_STILL && cue.lettings - tPick - picking > 1) {
  take("page", "reportsPick", 0, tPick, { footage: PICK_STILL });
  take("pick", "reportsPick", PICK_STILL, picking, { footage: PICK_DONE - PICK_STILL, speed: PICK_SPEED });
  take("card", "reportsPick", PICK_DONE, cue.lettings - tPick - picking);
} else take("pick", "reportsPick", 0, cue.lettings);
// 2. "lettings exchanged, Heads of Terms agreed, rental growth and deal speed, scheme by scheme"
const tHots = cue.hots - 0.2, tGrowth = cue.growth - 0.05, tSpeed = cue.speed + 1.15;
slide("headlines", page(pageOf("Headlines")), tHots - cue.lettings);
slide("activity", page(pageOf("Letting activity by scheme")), tGrowth - tHots);
slide("growth", page(pageOf("Rental growth")), tSpeed - tGrowth);
slide("speed", page(pageOf("Deal speed")), cue.targets - tSpeed);
// 3. "the tenants we are targeting, and how far each one has got"
const tGrid = cue.howfar - 0.15;
slide("targets", page(pageOf("Target tenants", true)), tGrid - cue.targets);
slide("inplay", page(pageOf("Target tenants: in play")), cue.market - tGrid, [0.02, 0.025, 0.70, 0.70]);
// 4. "a market view for each sector of what the industry did that quarter"
if (market && cue.m1) {
  // The Market report's own slides, held through the pause after the line. Real news: no mark. The Overview and
  // Competition start whole and move in to their list of top items; a sector's list is shown from its title to its
  // eighth row, without the source column, so a headline can be read.
  const ITEMS = { x: 0.025, y: 0.355, w: 0.58 }, LIST = [0.025, 0.02, 0.82, 0.762];
  slide("overview", market.page(market.pageOf("Overview", true)), cue.m1 - cue.market, null, false, ITEMS);
  slide("sector", market.page(market.pageOf(`${SECTOR}: who is doing what`)), cue.m2 - cue.m1, LIST, false);
  slide("sector2", market.page(market.pageOf(`${SECTOR2}: who is doing what`)), cue.m3 - cue.m2, LIST, false);
  slide("rivals", market.page(market.pageOf("Competition", true)), cue.out - cue.m3, null, false, ITEMS);
} else if (market) {
  // The Market report's own slides: the overview, one sector's "who is doing what", the competition. Real news: no mark.
  const tSector = cue.industry - 0.75, tRivals = cue.industry + 1.25;
  slide("overview", market.page(market.pageOf("Overview", true)), tSector - cue.market, null, false);
  slide("sector", market.page(market.pageOf(`${SECTOR}: who is doing what`)), tRivals - tSector, null, false);
  slide("rivals", market.page(market.pageOf("Competition", true)), cue.out - tRivals, null, false);
} else {
  const tSections = cue.industry + 0.5;
  slide("market", page(pageOf("Market report", true)), tSections - cue.market);
  slide("sections", page(pageOf("Market report:")), cue.out - tSections);
}
// 5. "as a PDF or a PowerPoint" on the page, then the deck's own first slide "in your colours, ready to present".
// With a `title` cue the take is played a little faster (the line is said more quickly than when it was filmed).
const tTitle = cue.title || cue.colours + 0.2, outSpeed = cue.title ? 1.4 : 1;
take("out", "reportsOut", 0, tTitle - cue.out, { footage: (tTitle - cue.out) * outSpeed + 0.2, speed: outSpeed });
slide("title", page(1), cue.end - tTitle + 0.8);

const list = path.join(tmp, "list.txt"); fs.writeFileSync(list, parts.map(p => `file '${p}'`).join("\n"));
const target = path.join(OUT, "reports.webm");      // named as the other clips are; it is H.264 in a Matroska file
ff(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-f", "matroska", target]);
const length = +execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", target]).toString().trim();
fs.appendFileSync(path.join(OUT, "film.log"), `reports trim 0.00 length ${length.toFixed(1)}\nMADE reports (reports-clip.cjs)\n`);
console.log(`wrote ${target} (${length.toFixed(1)}s for a scene of ${cue.end}s)`);
