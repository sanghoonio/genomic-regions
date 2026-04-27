// Click a token in the Step 3 region UMAP, verify Step 5 ego network renders.
import puppeteer from "puppeteer-core";

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--no-sandbox"]
});
const page = await browser.newPage();
await page.setViewport({width: 1400, height: 1200});
const events = [];
page.on("pageerror", (e) => events.push({type: "pageerror", msg: e.message, stack: e.stack}));

await page.goto("http://127.0.0.1:3000/", {waitUntil: "networkidle2"});
await new Promise((r) => setTimeout(r, 6000));

// Step 3 region UMAP is the first 900x600 SVG. Find it, scroll to it, click center.
const findStep3 = async () => {
  return page.evaluate(() => {
    const all = Array.from(document.querySelectorAll("svg"));
    const matches = all
      .map((s) => {
        const r = s.getBoundingClientRect();
        return {x: r.x, y: r.y, w: r.width, h: r.height};
      })
      .filter((c) => c.w > 800 && c.w < 1000 && c.h > 500 && c.h < 700);
    return matches[0] ?? null;
  });
};
let s3 = await findStep3();
console.log("step3 box (initial):", s3);
if (!s3) { console.error("could not find step 3"); process.exit(1); }

await page.evaluate((y) => window.scrollTo(0, y - 100), s3.y);
await new Promise((r) => setTimeout(r, 300));
s3 = await findStep3();
console.log("step3 box (scrolled):", s3);

// Click somewhere in the middle of the UMAP
await page.mouse.move(s3.x + s3.w * 0.55, s3.y + s3.h * 0.45);
await new Promise((r) => setTimeout(r, 300));
await page.mouse.down();
await page.mouse.up();
await new Promise((r) => setTimeout(r, 4000)); // wait for cooccurrence query (much smaller table than tokenized_corpus)

// Check Step 5 — count SVGs (should grow from 30 to 31 if ego rendered) and look for focal text
const after = await page.evaluate(() => {
  const svgs = document.querySelectorAll("svg").length;
  const placeholder = !!Array.from(document.querySelectorAll("div"))
    .find((d) => d.textContent.includes("Click a token in the Step 3 UMAP"));
  const focalCaption = Array.from(document.querySelectorAll("div"))
    .find((d) => d.textContent.includes("Focal token") && d.textContent.includes("active"));
  return {
    svgs,
    placeholderStillPresent: placeholder,
    focalCaptionText: focalCaption?.textContent?.slice(0, 250) ?? null
  };
});
console.log("after click:", after);

if (process.argv.includes("--screenshot")) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await new Promise((r) => setTimeout(r, 200));
  await page.setViewport({width: 1400, height: 5500, deviceScaleFactor: 1});
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({path: "scripts/page-step5.png", fullPage: true});
  console.log("screenshot → scripts/page-step5.png");
}

console.log("\nerrors:", events);
await browser.close();
