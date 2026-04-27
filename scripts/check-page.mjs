// Headless page check: navigate to the dev server, wait for network idle,
// and dump every console message + page error so we can see runtime issues
// from the terminal.
import puppeteer from "puppeteer-core";

const URL = process.argv[2] ?? "http://127.0.0.1:3000/";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox"]
});

const page = await browser.newPage();
const events = [];
page.on("console", (msg) =>
  events.push({type: msg.type(), text: msg.text(), loc: msg.location()})
);
page.on("pageerror", (err) =>
  events.push({type: "pageerror", text: err.message, stack: err.stack})
);
page.on("requestfailed", (req) =>
  events.push({type: "requestfailed", url: req.url(), reason: req.failure()?.errorText})
);

await page.evaluateOnNewDocument(() => {
  window.__pageEvents = [];
  window.addEventListener("error", (e) => window.__pageEvents.push({type: "error", msg: e.message, src: e.filename, line: e.lineno, col: e.colno, stack: e.error?.stack}));
  window.addEventListener("unhandledrejection", (e) => window.__pageEvents.push({type: "unhandledrejection", reason: String(e.reason), stack: e.reason?.stack}));
});

try {
  await page.goto(URL, {waitUntil: "networkidle2", timeout: 30000});
} catch (e) {
  events.push({type: "goto-error", text: e.message});
}

// Poll page state every 5s up to 60s, log progress
const snap = async () =>
  page.evaluate(() => ({
    svgs: document.querySelectorAll("svg").length,
    loading: document.querySelectorAll("observablehq-loading").length,
    errors: document.querySelectorAll(".observablehq--error").length,
    errorTexts: Array.from(document.querySelectorAll(".observablehq--error")).map((n) => n.textContent?.slice(0, 200) ?? "")
  }));
for (let s = 0; s < 30; s += 5) {
  await new Promise((r) => setTimeout(r, 5000));
  const snapshot = await snap();
  const pe = await page.evaluate(() => (window.__pageEvents ?? []).length);
  console.log(`t=+${s + 5}s`, JSON.stringify(snapshot), `pageEvents=${pe}`);
  if (pe > 0 || snapshot.svgs > 0) break;
}

const ctx = await page.evaluate(() => {
  const errs = Array.from(document.querySelectorAll(".observablehq--inspect, .observablehq pre")).map(
    (n) => n.textContent?.slice(0, 400) ?? ""
  );
  return {
    title: document.title,
    bodyTextLen: document.body?.innerText?.length ?? 0,
    numSvgs: document.querySelectorAll("svg").length,
    numPlots: document.querySelectorAll("svg.plot, figure.plot").length,
    cellsWithError: document.querySelectorAll(".observablehq--error").length,
    errorTexts: Array.from(document.querySelectorAll(".observablehq--error")).map((n) => n.textContent?.slice(0, 400) ?? ""),
    pending: document.querySelectorAll(".observablehq--running, .observablehq--pending").length,
    inspectSnippets: errs,
    bodyHtmlSample: document.body?.innerHTML?.slice(0, 4000) ?? "",
    pendingCells: Array.from(document.querySelectorAll("[id^='cell-']")).map((n) => ({id: n.id, cls: n.className, text: n.textContent?.slice(0, 80) ?? ""}))
  };
});

console.log("== context ==");
console.log(JSON.stringify(ctx, null, 2));
console.log("\n== events ==");
for (const e of events) console.log(JSON.stringify(e));

const pageEvents = await page.evaluate(() => window.__pageEvents ?? []);
console.log("\n== page-side error/rejection events ==");
for (const e of pageEvents) console.log(JSON.stringify(e));

if (process.argv.includes("--screenshot")) {
  await page.setViewport({width: 1400, height: 4000, deviceScaleFactor: 1});
  await page.screenshot({path: "scripts/page.png", fullPage: true});
  console.log("\nscreenshot → scripts/page.png");
}

await browser.close();
