import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 900, height: 1200 } });
for (const tag of ['before','after']) {
  await p.goto(`file:///tmp/r573-weekly-${tag}.pdf`, { waitUntil: 'load' }).catch(e=>console.log('goto', tag, e.message));
  await p.waitForTimeout(3500);
  await p.screenshot({ path: `qa/smoke-shots/r573-weekly-${tag}.png` });
  console.log('shot', tag);
}
await b.close();
