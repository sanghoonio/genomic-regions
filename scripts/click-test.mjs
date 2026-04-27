// Verify Step 4 click-any-file: click a file dot, confirm the right pane
// re-renders with highlighted active tokens and the caption updates.
import puppeteer from "puppeteer-core";

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--no-sandbox"]
});
const page = await browser.newPage();
await page.setViewport({width: 1400, height: 1200});
const events = [];
page.on("pageerror", (e) => events.push({type: "pageerror", msg: e.message}));

await page.goto("http://127.0.0.1:3000/", {waitUntil: "networkidle2"});
await new Promise((r) => setTimeout(r, 6000));

// Find the file UMAP — it's in the first plot inside the Section 4 flex container.
const beforeClick = await page.evaluate(() => {
  const captions = Array.from(document.querySelectorAll("#observablehq-main div"))
    .map((d) => d.textContent ?? "")
    .filter((t) => t.includes("Click a file") || t.includes("chr16 tokens active"));
  return captions[captions.length - 1] ?? "(no caption)";
});
console.log("BEFORE CLICK caption:", beforeClick);

// Click roughly in the middle of the file UMAP. The left UMAP is the first
// of the side-by-side pair in Section 4. We'll click somewhere with high dot
// density to make sure we hit one.
// Find the file UMAP SVG: 600x500-ish, towards the bottom-half of the page.
const fileUmapBox = await page.evaluate(() => {
  const all = Array.from(document.querySelectorAll("svg"));
  const candidates = all.map((s) => {
    const r = s.getBoundingClientRect();
    return {x: r.x, y: r.y, w: r.width, h: r.height};
  });
  // Step 4's two UMAPs are the only 600x500 plots. File UMAP is the one with smaller x.
  const matches = candidates.filter((c) => c.w > 500 && c.w < 700 && c.h > 400 && c.h < 600);
  matches.sort((a, b) => a.x - b.x);
  return {matches, picked: matches[0] ?? null};
});
console.log("candidates:", JSON.stringify(fileUmapBox, null, 2).slice(0, 500));
const box = fileUmapBox.picked;
if (box) {
  // Scroll the file UMAP into view (puppeteer mouse uses viewport coords).
  await page.evaluate((y) => window.scrollTo(0, y - 100), box.y);
  await new Promise((r) => setTimeout(r, 300));
  // Re-measure now that we're scrolled.
  const sbox = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll("svg"));
    const matches = all
      .map((s) => s.getBoundingClientRect())
      .filter((r) => r.width > 500 && r.width < 700 && r.height > 400 && r.height < 600)
      .sort((a, b) => a.x - b.x);
    const r = matches[0];
    return r ? {x: r.x, y: r.y, w: r.width, h: r.height} : null;
  });
  console.log("after-scroll box:", sbox);
  // Click center of the file UMAP
  await page.mouse.move(sbox.x + sbox.w * 0.5, sbox.y + sbox.h * 0.5);
  await new Promise((r) => setTimeout(r, 300));
  await page.mouse.down();
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 6000)); // wait for lazy DuckDB query (cold ~5s)

  const afterClick = await page.evaluate(() => {
    const captions = Array.from(document.querySelectorAll("#observablehq-main div"))
      .map((d) => d.textContent ?? "")
      .filter((t) => t.includes("Click a file") || t.includes("chr16 tokens active"));
    return captions[captions.length - 1] ?? "(no caption)";
  });
  console.log("AFTER CLICK caption:", afterClick);
}

if (process.argv.includes("--screenshot")) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await new Promise((r) => setTimeout(r, 300));
  await page.setViewport({width: 1400, height: 4000, deviceScaleFactor: 1});
  await page.screenshot({path: "scripts/page-clicked.png", fullPage: true});
  console.log("screenshot → scripts/page-clicked.png");
}

console.log("\nerrors:", events);
await browser.close();
