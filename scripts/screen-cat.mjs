import puppeteer from "puppeteer-core";
const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true, args: ["--no-sandbox"]
});
const page = await browser.newPage();
await page.setViewport({width: 1500, height: 1100, deviceScaleFactor: 2});
await page.goto("http://127.0.0.1:3001/", {waitUntil: "networkidle2", timeout: 60000});
await new Promise(r => setTimeout(r, 12000));
await page.evaluate(() => document.querySelector("#browse-the-module-catalogue")?.scrollIntoView({block: "start"}));
await new Promise(r => setTimeout(r, 800));
await page.screenshot({path: "scripts/cat-area.png"});
console.log("wrote scripts/cat-area.png");
await browser.close();
