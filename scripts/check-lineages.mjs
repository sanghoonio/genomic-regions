// Compare K562 / GM12878 / HepG2 specificity views.
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

await page.goto(URL, {waitUntil: "networkidle2", timeout: 60000});
await page.waitForFunction(
  () => Array.from(document.querySelectorAll("h2")).some((h) => h.textContent?.includes("learned grammar")),
  {timeout: 30000}
);
await new Promise((r) => setTimeout(r, 8000));

const labels = ["K562 specificity", "GM12878 specificity", "HepG2 specificity"];
for (const label of labels) {
  await page.evaluate((label) => {
    const lbls = Array.from(document.querySelectorAll("label"));
    for (const lbl of lbls) {
      if (lbl.textContent?.trim().includes(label)) {
        lbl.querySelector("input")?.click();
        return;
      }
    }
  }, label);
  await new Promise((r) => setTimeout(r, 1500));
  await page.evaluate(() => {
    const h2 = Array.from(document.querySelectorAll("h2")).find((h) => h.textContent?.includes("learned grammar"));
    h2?.scrollIntoView({behavior: "instant", block: "start"});
  });
  await new Promise((r) => setTimeout(r, 500));
  const safe = label.replace(/[^A-Za-z0-9]+/g, "_").toLowerCase();
  await page.screenshot({path: `scripts/lineage-${safe}.png`, fullPage: false});
  console.log(`wrote scripts/lineage-${safe}.png`);
}

if (errs.length) {
  console.log("errors:", errs);
}
await browser.close();
