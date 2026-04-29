import puppeteer from "puppeteer-core";
const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true, args: ["--no-sandbox"]
});
const page = await browser.newPage();
await page.setViewport({width: 1400, height: 1100, deviceScaleFactor: 2});
await page.goto("http://127.0.0.1:3001/", {waitUntil: "networkidle2", timeout: 60000});
await page.waitForFunction(
  () => Array.from(document.querySelectorAll("h2")).some(h => h.textContent?.includes("Looking up")),
  {timeout: 30000}
);
await new Promise(r => setTimeout(r, 8000));
await page.evaluate(() => {
  Array.from(document.querySelectorAll("h2")).find(h => h.textContent?.includes("Looking up"))?.scrollIntoView();
});
await new Promise(r => setTimeout(r, 800));
await page.screenshot({path: "scripts/showcase.png"});
console.log("wrote scripts/showcase.png");
await browser.close();
