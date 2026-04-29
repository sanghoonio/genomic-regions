// Click the first module row in the catalogue and screenshot the inline sentence.
import puppeteer from "puppeteer-core";
const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true, args: ["--no-sandbox"]
});
const page = await browser.newPage();
await page.setViewport({width: 1400, height: 1100, deviceScaleFactor: 2});

await page.goto("http://127.0.0.1:3001/", {waitUntil: "networkidle2", timeout: 60000});
await page.waitForFunction(
  () => Array.from(document.querySelectorAll("h2")).some(h => h.textContent?.includes("module catalogue")),
  {timeout: 30000}
);
await new Promise(r => setTimeout(r, 8000));

// Switch lens to active_vs_repressive_pan_cell — its 17 modules give us the
// pedagogically-richest case (AG cluster recovery validated there).
await page.evaluate(() => {
  const sel = Array.from(document.querySelectorAll("select")).find(
    (s) => s.options.length === 18
  );
  if (sel) {
    sel.value = "14";
    sel.dispatchEvent(new Event("input", {bubbles: true}));
    sel.dispatchEvent(new Event("change", {bubbles: true}));
  }
});
await new Promise(r => setTimeout(r, 3000));

// Click the first module row in the catalogue
await page.evaluate(() => {
  const h2 = Array.from(document.querySelectorAll("h2")).find(h => h.textContent?.includes("module catalogue"));
  h2?.scrollIntoView({behavior: "instant", block: "start"});
});
await new Promise(r => setTimeout(r, 800));

const clicked = await page.evaluate(() => {
  const headers = Array.from(document.querySelectorAll(".module-header"));
  if (headers.length === 0) return false;
  // Click the second row (so we don't pick the giant top one)
  headers[1]?.click();
  return true;
});
console.log("clicked second module row:", clicked);
await new Promise(r => setTimeout(r, 2500));

// Scroll to the catalogue area
await page.evaluate(() => {
  const h2 = Array.from(document.querySelectorAll("h2")).find(h => h.textContent?.includes("module catalogue"));
  h2?.scrollIntoView({behavior: "instant", block: "start"});
});
await new Promise(r => setTimeout(r, 600));

await page.screenshot({path: "scripts/module-sentence.png"});
console.log("wrote scripts/module-sentence.png");
await browser.close();
