// Renders the extension icons (PNG) from an SVG with headless Chromium. Run once: node tools/icons.mjs
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('../extension/icons/', import.meta.url));
const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#6d4bd8"/><stop offset=".55" stop-color="#1d8fd1"/><stop offset="1" stop-color="#19b39b"/>
    </linearGradient>
  </defs>
  <rect x="4" y="4" width="120" height="120" rx="30" fill="url(#g)"/>
  <g transform="translate(18 18) scale(3.8)" fill="#fff">
    <path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.14-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0l1.58 6.14a2 2 0 0 0 1.44 1.44l6.14 1.58a.5.5 0 0 1 0 .96l-6.14 1.58a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z"/>
    <circle cx="19.5" cy="4.5" r="1.6"/><circle cx="4.5" cy="18.5" r="1.2"/>
  </g>
</svg>`;

const browser = await chromium.launch();
const page = await browser.newPage();
for (const size of [16, 32, 48, 128]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{width:${size}px;height:${size}px;display:block}</style>${svg}`);
  await page.locator('svg').screenshot({ path: `${out}icon${size}.png`, omitBackground: true });
}
await browser.close();
console.log('Icons written to', out);
