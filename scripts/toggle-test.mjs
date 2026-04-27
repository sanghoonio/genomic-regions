// Click "continuous" radio in Step 1, then "tokens" — capture both screenshots.
import puppeteer from "puppeteer-core";

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--no-sandbox"]
});
const page = await browser.newPage();
await page.setViewport({width: 1400, height: 1200});
const errs = [];
page.on("pageerror", (e) => errs.push({type: "pageerror", msg: e.message}));

await page.goto("http://127.0.0.1:3000/", {waitUntil: "networkidle2"});
await new Promise((r) => setTimeout(r, 8000));

// Click the radio for `value` and screenshot section 1.
async function snapMode(idx, outName) {
  // Inputs.radio uses index-based values on its <input> elements; click the
  // one at this index and dispatch input/change so view() updates.
  await page.evaluate((i) => {
    const radios = Array.from(document.querySelectorAll("input[type=radio]"));
    const m = radios[i];
    if (m) {
      m.checked = true;
      m.dispatchEvent(new Event("input", {bubbles: true}));
      m.dispatchEvent(new Event("change", {bubbles: true}));
    }
  }, idx);
  await new Promise((r) => setTimeout(r, 1500));
  await page.evaluate(() => window.scrollTo(0, 0));
  await new Promise((r) => setTimeout(r, 200));
  await page.setViewport({width: 1400, height: 1200, deviceScaleFactor: 1});
  await page.screenshot({path: `/Users/sam/Documents/Work/genomic-regions/scripts/page-mode-${outName}.png`, fullPage: false});
  console.log(`mode[${idx}] → page-mode-${outName}.png`);
}

await snapMode(0, "continuous");
await snapMode(1, "peaks");
await snapMode(2, "tokens");

console.log("\nerrors:", errs);
await browser.close();
