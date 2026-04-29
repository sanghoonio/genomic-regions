// Cycle through each color toggle on the region UMAP and screenshot.
import puppeteer from "puppeteer-core";

const URL = process.argv[2] ?? "http://127.0.0.1:3001/";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox"]
});
const page = await browser.newPage();
await page.setViewport({width: 1400, height: 900, deviceScaleFactor: 2});

const errs = [];
page.on("pageerror", (e) => errs.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") errs.push(`console.error: ${m.text()}`);
});

await page.goto(URL, {waitUntil: "networkidle2", timeout: 60000});
await page.waitForFunction(
  () => Array.from(document.querySelectorAll("h2")).some((h) => h.textContent?.includes("learned grammar")),
  {timeout: 30000}
);
await new Promise((r) => setTimeout(r, 8000));

// Find the radio buttons for "Color regions by"
const labels = [
  "SCREEN class",
  "Genomic midpoint",
  "File count (log)",
  "Anchor score (PLS ↔ dELS)",
  "Activity score (active ↔ repressed)",
  "K562 specificity",
  "Target evidence count (log)"
];

for (const label of labels) {
  console.log(`Selecting: ${label}`);
  const clicked = await page.evaluate((label) => {
    // Find a label/input pair matching this text and click it
    const allLabels = Array.from(document.querySelectorAll("label"));
    for (const lbl of allLabels) {
      const txt = lbl.textContent?.trim() ?? "";
      if (txt.includes(label)) {
        const input = lbl.querySelector("input");
        if (input) {
          input.click();
          return true;
        }
      }
    }
    return false;
  }, label);
  if (!clicked) {
    console.log(`  WARN: didn't find label '${label}'`);
    continue;
  }
  await new Promise((r) => setTimeout(r, 2000));
  // Scroll to Section 2 region UMAP
  await page.evaluate(() => {
    const h2 = Array.from(document.querySelectorAll("h2")).find((h) => h.textContent?.includes("learned grammar"));
    h2?.scrollIntoView({behavior: "instant", block: "start"});
  });
  await new Promise((r) => setTimeout(r, 500));
  const safe = label.replace(/[^A-Za-z0-9]+/g, "_").toLowerCase();
  await page.screenshot({path: `scripts/color-${safe}.png`, fullPage: false});
  console.log(`  wrote scripts/color-${safe}.png`);
}

if (errs.length) {
  console.log("\n--- runtime errors ---");
  errs.forEach((e) => console.log(e));
}

await browser.close();
