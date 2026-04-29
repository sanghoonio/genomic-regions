// Switch the stratum lens to active_vs_repressive_pan_cell and verify
// both the card's Section 5 lens text AND the catalogue update.
import puppeteer from "puppeteer-core";
const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true, args: ["--no-sandbox"]
});
const page = await browser.newPage();
await page.setViewport({width: 1400, height: 900, deviceScaleFactor: 2});
await page.goto("http://127.0.0.1:3001/", {waitUntil: "networkidle2", timeout: 60000});
await page.waitForFunction(
  () => Array.from(document.querySelectorAll("h2")).some(h => h.textContent?.includes("module catalogue")),
  {timeout: 30000}
);
await new Promise(r => setTimeout(r, 6000));

// Snapshot before
const before = await page.evaluate(() => ({
  cardLens: document.body.innerText.match(/lens:\s*(\S+)/)?.[1] ?? null,
  cataloguePreamble: Array.from(document.querySelectorAll("span"))
    .map(s => s.textContent ?? "").find(t => t?.includes("modules in")) ?? null
}));
console.log("BEFORE:", JSON.stringify(before, null, 2));

// Switch to active_vs_repressive_pan_cell. Inputs.select stores option
// values as array indices, not the labels — we find the right select by
// option count (18) and pick index 14 (active_vs_repressive_pan_cell).
const switched = await page.evaluate(() => {
  const sel = Array.from(document.querySelectorAll("select")).find(
    (s) => s.options.length === 18
  );
  if (!sel) return false;
  sel.value = "14";
  sel.dispatchEvent(new Event("input", {bubbles: true}));
  sel.dispatchEvent(new Event("change", {bubbles: true}));
  return true;
});
console.log("Switched:", switched);
await new Promise(r => setTimeout(r, 3000));

// Snapshot after
const after = await page.evaluate(() => ({
  cardLens: document.body.innerText.match(/lens:\s*(\S+)/)?.[1] ?? null,
  cataloguePreamble: Array.from(document.querySelectorAll("span"))
    .map(s => s.textContent ?? "").find(t => t?.includes("modules in")) ?? null
}));
console.log("AFTER:", JSON.stringify(after, null, 2));

await page.evaluate(() => {
  Array.from(document.querySelectorAll("h2")).find(h => h.textContent?.includes("Looking up"))?.scrollIntoView();
});
await new Promise(r => setTimeout(r, 800));
await page.screenshot({path: "scripts/lens-switched.png"});
console.log("wrote scripts/lens-switched.png");
await browser.close();
