import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

const url = process.argv[2] || 'http://localhost:3000';
const label = process.argv[3] || '';
const screenshotDir = './temporary screenshots';

if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });

let n = 1;
while (fs.existsSync(path.join(screenshotDir, `screenshot-${n}${label ? '-' + label : ''}.png`))) n++;
const filename = `screenshot-${n}${label ? '-' + label : ''}.png`;
const outPath = path.join(screenshotDir, filename);

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 2 });
await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

// Scroll through page so IntersectionObserver fires for all reveal elements
await page.evaluate(async () => {
  const totalHeight = document.body.scrollHeight;
  const step = 200;
  for (let y = 0; y <= totalHeight; y += step) {
    window.scrollTo(0, y);
    await new Promise(r => setTimeout(r, 80));
  }
  // Force all reveals visible as fallback
  document.querySelectorAll('.reveal').forEach(el => el.classList.add('visible'));
  window.scrollTo(0, 0);
  await new Promise(r => setTimeout(r, 300));
});

await new Promise(r => setTimeout(r, 800));
await page.screenshot({ path: outPath, fullPage: true });
await browser.close();

console.log(`Screenshot saved: ${outPath}`);
