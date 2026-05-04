// Screenshot the integrated workspace (new §2).
import puppeteer from "puppeteer-core";
const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true, args: ["--no-sandbox"]
});
const page = await browser.newPage();
await page.setViewport({width: 1500, height: 1100, deviceScaleFactor: 2});

const errs = [];
page.on("pageerror", (e) => errs.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errs.push(`console.error: ${m.text()}`); });

await page.goto("http://127.0.0.1:3001/", {waitUntil: "networkidle2", timeout: 60000});
await page.waitForFunction(
  () => Array.from(document.querySelectorAll("h2")).some(h => h.textContent?.includes("The dictionary")),
  {timeout: 30000}
);
await new Promise(r => setTimeout(r, 10000));

// Screenshot the workspace area
await page.evaluate(() => {
  const h2 = Array.from(document.querySelectorAll("h2")).find(h => h.textContent?.includes("The dictionary"));
  h2?.scrollIntoView({behavior: "instant", block: "start"});
});
await new Promise(r => setTimeout(r, 800));
await page.screenshot({path: "scripts/integrated-workspace.png"});
console.log("wrote scripts/integrated-workspace.png");

// Scroll to see the workspace grid
await page.evaluate(() => window.scrollBy(0, 800));
await new Promise(r => setTimeout(r, 800));
await page.screenshot({path: "scripts/integrated-workspace-scroll.png"});
console.log("wrote scripts/integrated-workspace-scroll.png");

if (errs.length) {
  console.log("ERRORS:");
  errs.forEach(e => console.log(" ", e));
}
await browser.close();
