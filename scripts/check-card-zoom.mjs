// Take a zoomed screenshot of just Section 4 (the dictionary card).
import puppeteer from "puppeteer-core";

const URL = process.argv[2] ?? "http://127.0.0.1:3001/";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox"]
});
const page = await browser.newPage();
await page.setViewport({width: 1400, height: 1200, deviceScaleFactor: 2});

await page.goto(URL, {waitUntil: "networkidle2", timeout: 60000});
await page.waitForFunction(
  () => Array.from(document.querySelectorAll("h2")).some((h) => h.textContent?.includes("Looking up")),
  {timeout: 30000}
);
await new Promise((r) => setTimeout(r, 8000));

// Scroll Section 4 into view
await page.evaluate(() => {
  const h2 = Array.from(document.querySelectorAll("h2")).find((h) => h.textContent?.includes("Looking up"));
  h2?.scrollIntoView({behavior: "instant", block: "start"});
});
await new Promise((r) => setTimeout(r, 1000));

await page.screenshot({path: "scripts/card-zoom.png", fullPage: false});
console.log("wrote scripts/card-zoom.png");

await browser.close();
