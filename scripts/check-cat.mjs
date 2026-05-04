import puppeteer from "puppeteer-core";
const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true, args: ["--no-sandbox"]
});
const page = await browser.newPage();
await page.setViewport({width: 1500, height: 1100});
const errs = [];
page.on("pageerror", (e) => errs.push(`PAGEERR: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning")
    errs.push(`${m.type().toUpperCase()}: ${m.text()}`);
});
await page.goto("http://127.0.0.1:3001/", {waitUntil: "networkidle2", timeout: 60000});
await new Promise(r => setTimeout(r, 12000));
const info = await page.evaluate(() => {
  const h3 = document.querySelector("#browse-the-module-catalogue");
  if (!h3) return {no_h3: true};
  const next = [];
  let el = h3.nextElementSibling;
  for (let i = 0; i < 8 && el; i++) {
    next.push({
      tag: el.tagName,
      cls: el.className,
      text: (el.textContent ?? "").slice(0, 80),
      childCount: el.children.length
    });
    el = el.nextElementSibling;
  }
  // Look for module-row anywhere on page
  const modRows = document.querySelectorAll(".module-row").length;
  const errEls = document.querySelectorAll(".observablehq--error, .observablehq--inspect").length;
  return {h3_found: true, next_siblings: next, module_row_count: modRows, error_elements: errEls};
});
console.log(JSON.stringify(info, null, 2));
if (errs.length) {
  console.log("ERRORS:");
  errs.forEach(e => console.log(" ", e));
}
await browser.close();
