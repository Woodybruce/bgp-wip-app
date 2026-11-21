// Render a JavaScript-built web page in headless Chromium and return its
// HTML — for official-site checks where the plain fetch gets an empty app
// shell (200degrees.com, arabica.coffee: "The fetched website content is
// empty", 2026-09-23). One shared browser, closed after a minute idle;
// same Chromium the PDF generator uses.
let browserPromise: Promise<any> | null = null;
let idleTimer: NodeJS.Timeout | null = null;
let active = 0;
export let lastRenderError: string | null = null;

async function browser(): Promise<any> {
  if (!browserPromise) {
    browserPromise = (async () => {
      const puppeteer: any = (await import("puppeteer-core")).default || (await import("puppeteer-core"));
      const { resolveChromiumPath } = await import("./document-briefs");
      return puppeteer.launch({ args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"], executablePath: await resolveChromiumPath(), headless: true });
    })();
    browserPromise.catch(() => { browserPromise = null; });
  }
  return browserPromise;
}

function scheduleClose() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => {
    if (active > 0 || !browserPromise) return;
    const b = await browserPromise.catch(() => null);
    browserPromise = null;
    await b?.close().catch(() => {});
  }, 60_000);
}

/** The rendered page (HTML after scripts run) and where it ended up. */
export async function renderPageHtml(url: string, timeoutMs = 25_000): Promise<{ html: string; url: string } | null> {
  active++;
  let page: any = null;
  try {
    page = await (await browser()).newPage();
    await page.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36");
    await page.setRequestInterception(true);
    page.on("request", (r: any) => ["image", "media", "font"].includes(r.resourceType()) ? r.abort() : r.continue());
    await page.goto(url, { waitUntil: "networkidle2", timeout: timeoutMs }).catch(() => {});
    const html: string = await page.content();
    return { html: html.slice(0, 2 * 1024 * 1024), url: page.url() };
  } catch (error: any) {
    lastRenderError = String(error?.message || error).slice(0, 300);
    console.warn(`[render-page] ${url}: ${lastRenderError}`);
    return null;
  } finally {
    active--;
    await page?.close().catch(() => {});
    scheduleClose();
  }
}

// A copy of a public web page as a PDF, for the AML file (Woody, 21 November
// 2026: KYC4U keep a PDF of each web source; "yes lets do 1 to 4"). The page
// and everything it loads must be on a public address: every request the page
// makes is checked against the private-address guard (server/safe-fetch.ts)
// and refused when it would reach this machine or a private network.
// Downloads are refused. Each copy carries the address it was taken from and
// when, at the top of every page.
export async function renderPagePdf(url: string, opts: { stamp: string; timeoutMs?: number; maxBytes?: number } = { stamp: "" }): Promise<{ pdf: Buffer; finalUrl: string; title: string } | { error: string }> {
  const { assertPublicHost, isPrivateIp } = await import("./safe-fetch");
  let target: URL;
  try { target = new URL(url); } catch { return { error: "not a web address" }; }
  try { await assertPublicHost(target); } catch (e: any) { return { error: String(e?.message || e) }; }
  const dns = await import("node:dns/promises");
  const net = await import("node:net");
  const verdicts = new Map<string, Promise<boolean>>();
  const hostIsPublic = (host: string): Promise<boolean> => {
    const h = host.replace(/^\[|\]$/g, "").toLowerCase();
    if (!verdicts.has(h)) {
      verdicts.set(h, (async () => {
        if (net.isIP(h)) return !isPrivateIp(h);
        if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return false;
        try { return (await dns.lookup(h, { all: true })).every(r => !isPrivateIp(r.address)); } catch { return false; }
      })());
    }
    return verdicts.get(h)!;
  };
  active++;
  let page: any = null;
  try {
    page = await (await browser()).newPage();
    await page.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36");
    await page.setJavaScriptEnabled(true);
    try { await (await page.target().createCDPSession()).send("Page.setDownloadBehavior", { behavior: "deny" }); } catch {}
    await page.setRequestInterception(true);
    page.on("request", (r: any) => {
      let u: URL | null = null;
      try { u = new URL(r.url()); } catch { u = null; }
      if (!u) return r.abort().catch(() => {});
      if (u.protocol === "data:" || u.protocol === "blob:") return r.continue().catch(() => {});
      if (u.protocol !== "http:" && u.protocol !== "https:") return r.abort().catch(() => {});
      if (["media", "websocket", "eventsource"].includes(r.resourceType())) return r.abort().catch(() => {});
      hostIsPublic(u.hostname).then(ok => (ok ? r.continue() : r.abort())).catch(() => r.abort().catch(() => {}));
    });
    const response = await page.goto(target.toString(), { waitUntil: "networkidle2", timeout: opts.timeoutMs ?? 25_000 }).catch(() => null);
    const finalUrl = page.url();
    if (!/^https?:/i.test(finalUrl) || finalUrl === "about:blank") return { error: response ? "the page did not open" : "the page did not load in time" };
    if (response && response.status() >= 400) return { error: `the site answered ${response.status()}` };
    const title = String(await page.title().catch(() => "") || "").replace(/\s+/g, " ").trim().slice(0, 140);
    const esc = (t: string) => t.replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));
    const pdf: Buffer = Buffer.from(await page.pdf({
      format: "A4", printBackground: true, displayHeaderFooter: true,
      headerTemplate: `<div style="font-size:7px;font-family:Arial,sans-serif;color:#555;width:100%;padding:0 10mm;">Copy of ${esc(finalUrl.slice(0, 300))}${opts.stamp ? ` · ${esc(opts.stamp)}` : ""}</div>`,
      footerTemplate: `<div style="font-size:7px;font-family:Arial,sans-serif;color:#555;width:100%;padding:0 10mm;text-align:right;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>`,
      margin: { top: "14mm", bottom: "12mm", left: "10mm", right: "10mm" },
      timeout: 30_000,
    }));
    if (pdf.length > (opts.maxBytes ?? 20 * 1024 * 1024)) return { error: "the copy was too large" };
    return { pdf, finalUrl, title };
  } catch (error: any) {
    const message = String(error?.message || error).slice(0, 300);
    console.warn(`[render-page] PDF copy of ${url}: ${message}`);
    return { error: "the page could not be copied" };
  } finally {
    active--;
    await page?.close().catch(() => {});
    scheduleClose();
  }
}
