import puppeteer from "puppeteer-core";
const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true, args: ["--no-sandbox"]
});
const page = await browser.newPage();
await page.goto("http://127.0.0.1:3001/", {waitUntil: "networkidle2", timeout: 60000});
await new Promise(r => setTimeout(r, 8000));
const info = await page.evaluate(() => {
  // Look for the lens picker
  const selects = Array.from(document.querySelectorAll("select"));
  return selects.map((s) => ({
    options: Array.from(s.options).map(o => o.value).slice(0, 5),
    optCount: s.options.length,
    parentLabel: s.parentElement?.textContent?.slice(0, 80) ?? "?"
  }));
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
