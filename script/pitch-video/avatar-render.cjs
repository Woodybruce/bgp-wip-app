// Photographs the drawn presenters (avatars.html) one frame at a time and
// hands the frames to ffmpeg: a clear-backed strip to lay over an app scene,
// or a whole scene of its own (the joint agent's arrival, the ending).
//
//   const { open } = require("./avatar-render.cjs"); const r = await open();
//   await r.render(scene, "out.mov"); await r.close();
const path = require("path");
const { spawn } = require("child_process");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");

async function open() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const errors = []; page.on("pageerror", e => errors.push(e.message));
  await page.goto("file://" + path.join(__dirname, "avatars.html"));
  return {
    // scene.full: the whole picture, on its own background. Otherwise the strip from scene.top down, clear behind.
    async render(scene, out) {
      const frames = Math.round(scene.secs * scene.fps), full = !!scene.full, top = full ? 0 : (scene.top ?? 500);
      await page.evaluate(s => window.setup(s), scene);
      const args = ["-v", "error", "-y", "-f", "image2pipe", "-framerate", String(scene.fps), "-c:v", "png", "-i", "-",
        ...(full ? ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18"] : ["-c:v", "qtrle", "-pix_fmt", "argb"]), out];
      const ff = spawn("ffmpeg", args, { stdio: ["pipe", "inherit", "inherit"] });
      const done = new Promise((resolve, reject) => ff.on("exit", code => code ? reject(new Error(`ffmpeg ${code}`)) : resolve()));
      for (let i = 0; i < frames; i++) {
        await page.evaluate(n => window.frame(n), i);
        const png = await page.screenshot({ omitBackground: !full, clip: { x: 0, y: top, width: 1920, height: 1080 - top } });
        if (!ff.stdin.write(png)) await new Promise(r => ff.stdin.once("drain", r));
      }
      ff.stdin.end(); await done;
      if (errors.length) throw new Error(`avatar page: ${errors[0]}`);
      return { top };
    },
    close: () => browser.close(),
  };
}
module.exports = { open };
