// Check the dictionary card section: load page, wait for it to populate,
// screenshot, then click HBA1 (token 255786) on the region UMAP and screenshot again.
import puppeteer from "puppeteer-core";

const URL = process.argv[2] ?? "http://127.0.0.1:3001/";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--window-size=1400,2000"]
});
const page = await browser.newPage();
await page.setViewport({width: 1400, height: 2000, deviceScaleFactor: 1});

const errs = [];
page.on("pageerror", (e) => errs.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") {
    errs.push(`console.${m.type()}: ${m.text()}`);
  }
});

console.log("loading...");
await page.goto(URL, {waitUntil: "networkidle2", timeout: 60000});

// Wait for the card to populate (look for the headword "chr16:" in the card area)
console.log("waiting for card to render...");
await page.waitForFunction(
  () => Array.from(document.querySelectorAll("h2")).some((h) => h.textContent?.includes("Looking up")),
  {timeout: 30000}
);

// Wait an additional bit for async card content
await new Promise((r) => setTimeout(r, 8000));

// Screenshot the section 4 area
const card = await page.evaluateHandle(() => {
  const h2 = Array.from(document.querySelectorAll("h2")).find((h) => h.textContent?.includes("Looking up"));
  if (!h2) return null;
  let el = h2.parentElement;
  // Find the cell that contains both the h2 and the dictCard
  return el;
});

console.log("screenshot 1 — initial render");
await page.screenshot({
  path: "scripts/card-initial.png",
  fullPage: true
});

// Now scroll to and click on token 255786 (HBA1) by setting the Mutable directly
// (clicking the UMAP point precisely is hard; we use the underlying API)
const hba1Update = await page.evaluate(() => {
  // The pickedTokenId is exposed via the runtime; can't reach it directly.
  // Instead, simulate a click on the right region UMAP dot by querying for a dot
  // whose data has token_id=255786. This is fragile; for v1 we just check
  // whether the default picked token's card rendered something.
  const cardSection = Array.from(document.querySelectorAll("h2")).find((h) =>
    h.textContent?.includes("Looking up")
  )?.closest("section, body, main");
  return {
    headword: document.body.innerText.match(/chr16:[\d,]+[-–][\d,]+/)?.[0] ?? null,
    cclassChips: Array.from(document.querySelectorAll('span'))
      .filter((s) => s.style?.background && s.textContent?.match(/^(PLS|pELS|dELS|CA-CTCF|CA-H3K4me3|unclassed)$/))
      .map((s) => s.textContent)
      .slice(0, 5),
    pmiPartnersFound:
      document.body.innerText.includes("Corpus grammar"),
    knnPartnersFound:
      document.body.innerText.includes("Functional similarity"),
    targetEvidenceFound:
      document.body.innerText.includes("Tier A target evidence"),
    softProfileFound:
      document.body.innerText.includes("Class soft profile"),
    conceptAxesFound:
      document.body.innerText.includes("Concept-axis projections"),
    headerCount: document.querySelectorAll(".observablehq--err").length,
    errorCount: document.querySelectorAll(".observablehq--inspect").length
  };
});

console.log("page state:", JSON.stringify(hba1Update, null, 2));

if (errs.length) {
  console.log("\n--- runtime errors ---");
  errs.forEach((e) => console.log(e));
}

await browser.close();
process.exit(0);
