// Cuts the Landsec pitch film to Woody's recorded voice. One recording (him
// to camera, reading the lines) and a cut list that says, for each scene,
// which stretches of the recording belong to it:
//   - "camera": the recording itself for those stretches (or, for the opening,
//     the clip named by INTRO: Woody on his phone, cut to where he speaks);
//   - "clip": a filmed app scene under his voice, sped up to fit the line and
//     never faster than can be followed (it runs on in silence when the scene
//     needs longer than the line), with the drawn presenters over it;
//   - "drawn": a scene that is all drawing (the joint agent's arrival);
//   - "hero": the ending, the BGP signal and the fly-off, with HERO_VOICE.
// The presenters (avatars.html) talk in time with the voice: their mouths
// follow its loudness frame by frame, and the cut list says when they point,
// wave and give a thumbs up. The cut list is made from the transcript, with
// false starts, hesitations and long pauses left out; it is not in the repo.
// It also says where each stretch of a line sits in its scene (`starts`), so a
// line is spread over a scene that outlasts it, when each caption shows
// (`caps`), and where a quiet sound goes (`sfx`: a pop, a chime, a rush of air).
//
//   REC=<recording.mp4> CUT=<cutlist.json> OUT_DIR=<folder with the clips and film.log> \
//     AVATAR_ART=<folder> [HERO_VOICE=<wav>] [INTRO=<phone clip> INTRO_TEXT=<its words> INTRO_TRIM=<from,to>] [ONLY=properties,unit] [REDO=hots] node script/pitch-video/voice-cut.cjs [out.mp4]
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const { REC, CUT, OUT_DIR: OUT } = process.env;
for (const [name, file] of [["REC", REC], ["CUT", CUT], ["OUT_DIR", OUT]]) if (!file || !fs.existsSync(file)) { console.error(`${name} not found`); process.exit(1); }
const target = process.argv[2] || path.join(OUT, "voice-cut.mp4");
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null;
const items = JSON.parse(fs.readFileSync(CUT, "utf8")).filter(it => !ONLY || ONLY.has(it.clip || it.name));
// REDO=hots,brief: make only those scenes again and reuse every other part from the last run.
const REDO = process.env.REDO ? new Set(process.env.REDO.split(",")) : null;
// AVATAR_ART: the folder with the character drawings and their rig.json (kept outside the repo).
const ART = process.env.AVATAR_ART, RIG = ART && fs.existsSync(path.join(ART, "rig.json")) ? JSON.parse(fs.readFileSync(path.join(ART, "rig.json"), "utf8")) : null;
const cast = { rig: RIG, art: ART ? "file://" + path.resolve(ART) + "/" : "" };
const CAPTIONS = process.env.CAPTIONS !== "0", AVATARS = process.env.AVATARS !== "0" && !!RIG;
const MAX_SPEED = Number(process.env.MAX_SPEED || 2.6), MAX_PHONE_SPEED = Number(process.env.MAX_PHONE_SPEED || 3.2), FPS = 25;
const FONT = ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"].find(f => fs.existsSync(f));
const FONT_BOLD = ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"].find(f => fs.existsSync(f)) || FONT;
const LOGO = path.join(__dirname, "..", "..", "server", "assets", "BGP_BlackHolder.png");

const log = fs.existsSync(path.join(OUT, "film.log")) ? fs.readFileSync(path.join(OUT, "film.log"), "utf8") : "";
const trimOf = name => { const m = [...log.matchAll(new RegExp(`^${name} trim ([0-9.]+) length ([0-9.]+)`, "gm"))].pop(); return m ? { trim: +m[1], length: +m[2] } : null; };
const esc = t => t.replace(/\\/g, "\\\\").replace(/'/g, "\u2019").replace(/:/g, "\\:").replace(/%/g, "\\%").replace(/,/g, "\\,");
const wrap = (text, width) => {
  const lines = []; let line = "";
  for (const w of text.split(/\s+/)) { if ((line + " " + w).trim().length > width) { lines.push(line.trim()); line = w; } else line += " " + w; }
  if (line.trim()) lines.push(line.trim());
  return lines;
};
// The line as captions, two lines at a time. `said` is the text (each sentence
// then gets its share of `secs`) or the cut list's own lines with their times.
// `centre` and `width` keep them clear of the presenters at the sides.
function captions(said, secs, { centre = 960, width = 86, y0 = 955, delay = 0 } = {}) {
  if (!CAPTIONS || !said || !said.length) return [];
  let lines = said;
  if (typeof said === "string") {
    const parts = said.match(/[^.!?]+[.!?]+/g) || [said], total = parts.reduce((n, p) => n + p.length, 0);
    let t = delay; lines = parts.map(p => { const d = secs * p.length / total, line = { t0: t, t1: t + d, text: p.trim() }; t += d; return line; });
  }
  const out = [];
  for (const { t0, t1, text } of lines) {
    const rows = wrap(text, width), pages = [];
    for (let i = 0; i < rows.length; i += 2) pages.push(rows.slice(i, i + 2));
    const chars = pages.map(pg => pg.join(" ").length), sum = chars.reduce((a, b) => a + b, 0);
    let pt = t0;
    pages.forEach((pg, k) => {
      const pd = (t1 - t0) * chars[k] / sum;
      pg.forEach((l, i) => out.push(`drawtext=fontfile=${FONT}:text='${esc(l)}':fontcolor=white:fontsize=30:x=${centre}-text_w/2:y=${y0 + i * 42 - (pg.length - 1) * 21}:box=1:boxcolor=black@0.72:boxborderw=12:enable='between(t\\,${pt.toFixed(2)}\\,${(pt + pd).toFixed(2)})'`));
      pt += pd;
    });
  }
  return out;
}

const tmp = path.join(OUT, ".voice-parts");
fs.mkdirSync(tmp, { recursive: true });
const ff = args => execFileSync("ffmpeg", ["-v", "error", "-y", ...args], { stdio: "inherit" });
const OUTV = ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-r", String(FPS)], OUTA = ["-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2"];

const CHAIN = "equalizer=f=140:t=q:w=1:g=2,equalizer=f=300:t=q:w=1.2:g=-2.5,equalizer=f=3200:t=q:w=1.2:g=3.5,equalizer=f=6500:t=q:w=1.5:g=2,acompressor=threshold=-21dB:ratio=2.6:attack=8:release=140:makeup=2,loudnorm=I=-16:TP=-1.5:LRA=9,aresample=48000";
// The voice, cleaned once for the whole recording so every scene sits at one
// level: rumble and hiss taken down, a little warmth and presence put back
// (a call recording is thin), evened out, and brought to one loudness.
const voice = path.join(tmp, "voice.wav");
if (!fs.existsSync(voice) || fs.statSync(voice).mtimeMs < fs.statSync(REC).mtimeMs) {
  ff(["-i", REC, "-vn", "-af", `highpass=f=80,afftdn=nf=-30,${CHAIN}`, "-ac", "2", voice]);
}
// A line's audio on its own. Each stretch goes where the cut list puts it
// (`starts`), or they run on from one another after `lead`.
function lineAudio(item, file, secs, lead) {
  const r = item.ranges; let t = lead;
  const at = r.map(([a, b], i) => { const s = item.starts ? item.starts[i] : t; t += b - a; return s; });
  const graph = r.map(([a, b], i) => `[0:a]atrim=start=${a}:end=${b},asetpts=PTS-STARTPTS,afade=t=in:d=0.025,afade=t=out:st=${Math.max(0, b - a - 0.05).toFixed(2)}:d=0.05,adelay=${Math.round(at[i] * 1000)}:all=1[a${i}]`).join(";")
    + `;${r.map((_, i) => `[a${i}]`).join("")}amix=inputs=${r.length}:normalize=0:dropout_transition=0,apad[a]`;
  ff(["-i", voice, "-filter_complex", graph, "-map", "[a]", "-t", secs.toFixed(2), "-ar", "48000", "-ac", "2", file]);
}
// Quiet sounds under the voice, all made here: a pop as someone appears, a
// chime for a good moment, a rush of air for a flight. They sit well under him.
const SFX = {
  pop: v => `aevalsrc='${(0.22 * v).toFixed(3)}*sin(2*PI*(620-1500*t)*t)*exp(-30*t)':d=0.16:s=48000`,
  chime: v => `aevalsrc='${(0.11 * v).toFixed(3)}*(sin(2*PI*1319*t)*exp(-6*t)+gt(t,0.09)*sin(2*PI*1568*(t-0.09))*exp(-6*(t-0.09))+gt(t,0.18)*sin(2*PI*2093*(t-0.18))*exp(-5*(t-0.18)))':d=1.3:s=48000`,
  whoosh: v => `anoisesrc=d=0.8:c=pink:a=${(0.3 * v).toFixed(3)}:r=48000,bandpass=f=1100:w=900,afade=t=in:d=0.35,afade=t=out:st=0.35:d=0.45`,
};
function withSounds(item, wav, secs) {
  const list = (item.sfx || []).filter(x => SFX[x.kind] && x.t >= 0 && x.t < secs);
  if (!list.length) return wav;
  const out = wav.replace(/\.wav$/, "-mix.wav");
  const graph = list.map((x, i) => `${SFX[x.kind](x.vol || 1)},aformat=channel_layouts=stereo,adelay=${Math.round(x.t * 1000)}:all=1[s${i}]`).join(";")
    + `;[0:a]${list.map((_, i) => `[s${i}]`).join("")}amix=inputs=${list.length + 1}:normalize=0:duration=first:dropout_transition=0[a]`;
  ff(["-i", wav, "-filter_complex", graph, "-map", "[a]", "-t", secs.toFixed(2), "-ar", "48000", "-ac", "2", out]);
  return out;
}
function mouthOf(file, secs) {
  const pcm = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-ac", "1", "-ar", "8000", "-f", "s16le", "-"], { maxBuffer: 1 << 28 });
  const per = 8000 / FPS, frames = Math.round(secs * FPS), out = []; let prev = 0;
  for (let f = 0; f < frames; f++) {
    let sum = 0, n = 0;
    for (let i = Math.floor(f * per); i < Math.floor((f + 1) * per) && i * 2 + 1 < pcm.length; i++) { const v = pcm.readInt16LE(i * 2) / 32768; sum += v * v; n++; }
    const db = 10 * Math.log10((n ? sum / n : 0) + 1e-9), open = Math.min(1, Math.max(0, (db + 40) / 22));
    prev = open > prev ? prev + (open - prev) * 0.75 : prev + (open - prev) * 0.45;   // opens quickly, closes a touch slower
    out.push(+prev.toFixed(3));
  }
  return out;
}

(async () => {
  const stage = AVATARS ? await require("./avatar-render.cjs").open() : null;
  const parts = [], missing = [];
  let n = 0, lastFrame = null;
  for (const item of items) {
    const name = item.clip || item.name;
    const file = path.join(tmp, `${String(n++).padStart(2, "0")}-${name}.mp4`), wav = path.join(tmp, `${name}.wav`);
    const ranges = item.ranges, spoken = ranges.reduce((s, [a, b]) => s + (b - a), 0);
    if (REDO && !REDO.has(name) && fs.existsSync(file)) {
      if (item.kind === "camera" && fs.existsSync(path.join(tmp, `${name}-last.png`))) lastFrame = path.join(tmp, `${name}-last.png`);
      parts.push(file); continue;
    }

    if (item.kind === "camera") {
      const nameCard = t1 => [`drawtext=fontfile=${FONT_BOLD}:text='Woody Bruce':fontcolor=white:fontsize=40:x=110:y=820:box=1:boxcolor=0x6E0C25@0.92:boxborderw=14:enable='between(t\\,0.9\\,${t1})'`,
        `drawtext=fontfile=${FONT}:text='Bruce Gillingham Pollard':fontcolor=white:fontsize=26:x=110:y=884:box=1:boxcolor=black@0.6:boxborderw=10:enable='between(t\\,0.9\\,${t1})'`];
      lastFrame = path.join(tmp, `${name}-last.png`);
      const own = item.name === "intro" && process.env.INTRO;
      if (own) {
        // His own clip (a phone, on a viewing). Cut to where he speaks, unless INTRO_TRIM says where;
        // an upright clip sits on a blurred copy of itself. The voice gets the same clean-up as the rest.
        if (!fs.existsSync(own)) { console.error("INTRO not found"); process.exit(1); }
        const length = +execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", own]).toString().trim();
        let [a, b] = (process.env.INTRO_TRIM || "").split(",").map(Number);
        if (!(b > a)) {
          const heard = require("child_process").spawnSync("ffmpeg", ["-v", "info", "-i", own, "-vn", "-af", "silencedetect=noise=-38dB:d=0.4", "-f", "null", "-"]).stderr.toString();
          const quiet = [...heard.matchAll(/silence_start: ([0-9.]+)[\s\S]*?silence_end: ([0-9.]+)/g)].map(m => [+m[1], +m[2]]);
          a = quiet.length && quiet[0][0] < 0.3 ? Math.max(0, quiet[0][1] - 0.5) : 0;
          const tail = [...heard.matchAll(/silence_start: ([0-9.]+)/g)].map(m => +m[1]).pop();
          b = tail != null && tail > a + 1 && !quiet.some(q => q[0] === tail && q[1] < length - 0.2) ? Math.min(length, tail + 0.6) : length;
        }
        const secs = b - a, text = process.env.INTRO_TEXT || item.introText || "";
        ff(["-ss", a.toFixed(2), "-t", secs.toFixed(2), "-i", own, "-filter_complex",
          `[0:v]fps=${FPS},split[p][q];[p]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,boxblur=28:4[bg];[q]scale=1920:1080:force_original_aspect_ratio=decrease:flags=lanczos[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1,${["fade=t=in:st=0:d=0.5", ...nameCard(Math.min(5, secs - 0.5).toFixed(2)), ...captions(text, secs - 0.5, { delay: 0.2 })].join(",")}[v];[0:a]highpass=f=90,afftdn=nf=-25,${CHAIN},afade=t=in:d=0.15[a]`,
          "-map", "[v]", "-map", "[a]", "-t", secs.toFixed(2), ...OUTV, ...OUTA, file]);
        ff(["-sseof", "-0.2", "-i", file, "-frames:v", "1", "-update", "1", lastFrame]);
        parts.push(file); console.log(`${name.padEnd(15)} his own clip ${secs.toFixed(1)}s (from ${a.toFixed(1)}s to ${b.toFixed(1)}s of it)`); continue;
      }
      // The recording itself. Each stretch is framed a little differently, so a cut reads as a cut;
      // the opening fades up, which also covers the glance down before the first word.
      const offset = Math.max(0, ranges[0][0] - 3);
      lineAudio(item, wav, spoken, 0);
      const video = ranges.map(([a, b], i) => `[0:v]trim=start=${(a - offset).toFixed(2)}:end=${(b - offset).toFixed(2)},setpts=PTS-STARTPTS,fps=${FPS},${i % 2 ? "crop=iw/1.08:ih/1.08:(iw-ow)/2:(ih-oh)*0.35," : ""}scale=1920:1080:flags=lanczos,setsar=1[v${i}]`).join(";")
        + `;${ranges.map((_, i) => `[v${i}]`).join("")}concat=n=${ranges.length}:v=1:a=0[vc]`;
      const draw = [...(item.name === "intro" ? ["fade=t=in:st=0:d=0.7", ...nameCard(Math.min(6, spoken).toFixed(2))] : []), ...captions(item.caps || item.text, spoken)];
      ff(["-ss", String(offset), "-i", REC, "-i", wav, "-filter_complex", `${video};[vc]${draw.length ? draw.join(",") : "null"}[v]`,
        "-map", "[v]", "-map", "1:a", "-t", spoken.toFixed(2), ...OUTV, ...OUTA, file]);
      // The last picture of him, for the moment he turns into the drawn presenter.
      ff(["-ss", (ranges[ranges.length - 1][1] - 0.25).toFixed(2), "-i", REC, "-frames:v", "1", "-vf", "scale=1920:1080", "-update", "1", lastFrame]);
      parts.push(file); console.log(`${name.padEnd(15)} on camera ${spoken.toFixed(1)}s`); continue;
    }

    if (item.kind === "hero") {
      const secs = item.secs, pic = path.join(tmp, "hero.mp4"), heroVoice = process.env.HERO_VOICE;
      const logo = "data:image/png;base64," + fs.readFileSync(LOGO).toString("base64");
      const mouth = heroVoice && fs.existsSync(heroVoice) ? (() => { const padded = path.join(tmp, "hero-voice.wav"); ff(["-i", heroVoice, "-af", "adelay=1700|1700,apad", "-t", String(secs), "-ar", "48000", "-ac", "2", padded]); return mouthOf(padded, secs); })() : [];
      if (stage) await stage.render({ ...cast, mode: "hero", full: true, fps: FPS, secs, logo, mouth, flyAt: item.flyAt }, pic);
      else ff(["-f", "lavfi", "-i", `color=c=0x0b0d1e:s=1920x1080:r=${FPS}:d=${secs}`, ...OUTV, pic]);
      // A rush of air as he goes, made from filtered noise.
      const whoosh = `anoisesrc=d=1.6:c=pink:a=0.5,bandpass=f=900:w=700,afade=t=in:d=0.5,afade=t=out:st=0.7:d=0.9,adelay=${Math.round(item.flyAt * 1000 - 200)}|${Math.round(item.flyAt * 1000 - 200)},apad[w]`;
      const voiceIn = mouth.length ? ["-i", path.join(tmp, "hero-voice.wav")] : ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"];
      ff(["-i", pic, ...voiceIn, "-filter_complex", `[0:v]${["fade=t=in:d=0.5", `fade=t=out:st=${(secs - 0.7).toFixed(2)}:d=0.7`, ...captions(item.text, 4.2, { delay: 1.7, y0: 990 })].join(",")}[v];${whoosh};[1:a][w]amix=inputs=2:duration=first:normalize=0[a]`,
        "-map", "[v]", "-map", "[a]", "-t", String(secs), ...OUTV, ...OUTA, file]);
      parts.push(file); console.log(`${name.padEnd(15)} drawn ${secs.toFixed(1)}s`); continue;
    }

    if (item.kind === "drawn") {
      // All drawing: the scene file says who is where; the voice opens the mouths.
      // `photo` is where he turns into the presenter: the last picture of him folds into the drawing.
      const secs = item.scene.secs, pic = path.join(tmp, `${name}-pic.mp4`), lead = item.lead ?? 0.15;
      lineAudio(item, wav, secs, lead);
      const scene = { ...item.scene, photo: item.scene.photo && lastFrame ? { ...item.scene.photo, src: "file://" + lastFrame } : null };
      if (stage) await stage.render({ ...cast, ...scene, fps: FPS, mouth: mouthOf(wav, secs) }, pic);
      else ff(["-f", "lavfi", "-i", `color=c=0xEFEAE2:s=1920x1080:r=${FPS}:d=${secs}`, ...OUTV, pic]);
      ff(["-i", pic, "-i", withSounds(item, wav, secs), "-filter_complex", `[0:v]${captions(item.caps || item.text, spoken, { delay: lead, ...(item.capAt || {}) }).join(",") || "null"}[v]`, "-map", "[v]", "-map", "1:a", "-t", secs.toFixed(2), ...OUTV, ...OUTA, file]);
      parts.push(file); console.log(`${name.padEnd(15)} drawn ${secs.toFixed(1)}s`); continue;
    }

    const src = path.join(OUT, `${item.clip}.webm`), t = trimOf(item.clip);
    if (!fs.existsSync(src) || !t) { missing.push(item.clip); continue; }
    const raw = Math.min(item.max || 1e9, Math.max(4, t.length - t.trim - 0.6));
    // Long enough for the line, and for the scene at a pace that can be followed.
    const lastEnd = item.starts ? Math.max(...ranges.map(([a, b], i) => item.starts[i] + b - a)) : 0.15 + spoken;
    const secs = Math.max(lastEnd + 0.15, raw / (item.phone ? MAX_PHONE_SPEED : MAX_SPEED)), speed = raw / secs;
    lineAudio(item, wav, secs, 0.15);
    const actors = stage && item.actors && item.actors.length ? item.actors : null;
    let overlay = null, top = 0;
    if (actors) {
      overlay = path.join(tmp, `${name}-avatars.mov`);
      ({ top } = await stage.render({ ...cast, fps: FPS, secs, top: 300, mouth: mouthOf(wav, secs), actors, bursts: item.bursts }, overlay));
    }
    const base = [
      `setpts=PTS/${speed.toFixed(4)}`,
      ...(item.phone ? ["crop=390:844:0:0", "scale=-2:860:flags=lanczos", "pad=1920:1080:(ow-iw)/2-150:30:color=0x1c1917"] : ["scale=1920:1080:flags=lanczos"]),
      `fps=${FPS}`, "setsar=1",
    ].join(",");
    const marks = [
      ...(item.mark ? [`drawtext=fontfile=${FONT}:text='Illustration':fontcolor=white:fontsize=24:x=w-text_w-40:y=36:box=1:boxcolor=0xB8622F@0.9:boxborderw=10`] : []),
      ...captions(item.caps || item.text, spoken, actors ? { centre: item.phone ? 700 : 1075, width: item.phone ? 62 : 50, delay: 0.15 } : { delay: 0.15 }),
    ];
    // Where he turns into the presenter: his last picture shrinks into the corner as the drawing pops up.
    const morph = item.morph && lastFrame && actors;
    const inputs = ["-ss", String(t.trim), "-t", String(raw), "-i", src, "-i", withSounds(item, wav, secs), ...(overlay ? ["-i", overlay] : []), ...(morph ? ["-loop", "1", "-t", "1", "-i", lastFrame] : [])];
    let graph = `[0:v]${base}[b0]`, last = "b0";
    if (morph) {
      const k = "min(t/0.75\\,1)", idx = overlay ? 3 : 2;
      graph += `;[${idx}:v]fps=${FPS},scale=w='trunc(1920*(1-0.86*${k})/2)*2':h='trunc(1080*(1-0.86*${k})/2)*2':eval=frame,format=rgba,fade=t=out:st=0.6:d=0.3:alpha=1[m];[${last}][m]overlay=x='(1920-w-70)*${k}':y='(1080-h-150)*${k}':eof_action=pass[b1]`; last = "b1";
    }
    if (overlay) { graph += `;[${last}][2:v]overlay=0:${top}:eof_action=pass[b2]`; last = "b2"; }
    graph += `;[${last}]${marks.length ? marks.join(",") : "null"}[v]`;
    ff([...inputs, "-filter_complex", graph, "-map", "[v]", "-map", "1:a", "-t", secs.toFixed(2), ...OUTV, ...OUTA, file]);
    parts.push(file);
    console.log(`${name.padEnd(15)} line ${spoken.toFixed(1)}s, on screen ${secs.toFixed(1)}s, played at ${speed.toFixed(2)}x${actors ? `, ${actors.length} presenter${actors.length === 1 ? "" : "s"}` : ""}`);
  }
  if (stage) await stage.close();
  const listFile = path.join(tmp, "list.txt");
  fs.writeFileSync(listFile, parts.map(p => `file '${p}'`).join("\n"));
  ff(["-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", "-movflags", "+faststart", target]);
  const dur = +execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", target]).toString().trim();
  console.log(`wrote ${target} (${Math.floor(dur / 60)}:${String(Math.round(dur % 60)).padStart(2, "0")})${missing.length ? `, scenes not filmed: ${missing.join(", ")}` : ""}`);
})().catch(error => { console.error(error); process.exit(1); });
