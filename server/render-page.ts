// Render a JavaScript-built web page in headless Chromium and return its
// HTML — for official-site checks where the plain fetch gets an empty app
// shell (200degrees.com, arabica.coffee: "The fetched website content is
// empty", 2026-09-23). One shared browser, closed after a minute idle;
// same Chromium the PDF generator uses.
let browserPromise: Promise<any> | null = null;
let idleTimer: NodeJS.Timeout | null = null;
let active = 0;

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
  } catch {
    return null;
  } finally {
    active--;
    await page?.close().catch(() => {});
    scheduleClose();
  }
}
