// Optional tooling: npm install --no-save --package-lock=false playwright sharp
// Then: npx playwright install chromium && node scripts/render-store-screenshots.cjs
const { chromium } = require("playwright");
const sharp = require("sharp");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const assets = path.join(root, "store-assets");
const scenes = [
  ["capture", "01-capture", "capture"],
  ["library", "02-library", "library"],
  ["bulk", "03-bulk-actions", "bulk-actions"],
  ["portability", "04-portability", "portability"],
  ["collapsed", "05-collapsed", "collapsed"]
];
const sceneCopy = {
  library: ["Keep the words.<br>Keep the context.", "Search your saved snippets, notes, and sources. Return to the ideas worth keeping."],
  bulk: ["A little order.<br>A clearer library.", "Tag, archive, copy, or export a selection of cards with a compact set of controls."],
  portability: ["Your words,<br>where you need them.", "Keep a restorable JSON backup, take Markdown to your notes, or open CSV in a spreadsheet."],
  collapsed: ["See more of<br>what you’ve saved.", "Collapse every card for a quieter overview. Expand them again when you want the details."]
};

function fixtureCards(scene) {
  const entries = [
    ["Attention is the beginning of devotion.", "A reminder to notice before trying to interpret.", ["reading", "attention"], "Upstream — Mary Oliver"],
    ["What we pay attention to grows.", "", ["attention"], "Notes on attention"],
    ["serendipity", "Finding something valuable when you were looking for something else.", ["vocabulary"], "Words to remember"],
    ["Make room for the unexpected.", "", ["ideas"], "Collected notes"],
    ["in good time", "", ["expressions"], "Everyday language"],
    ["A useful question can change the conversation.", "", ["ideas"], "Collected notes"],
    ["Return to what matters.", "", ["reflection"], "Collected notes"]
  ];
  if (scene === "portability") {
    entries.unshift(["The limits of my language mean the limits of my world.", "Portable notes should remain useful outside the tool that captured them.", ["language", "philosophy"], "Notes on language"]);
    for (let i = entries.length; i < 12; i++) entries.push([`Collected thought ${i + 1}`, "", ["reflection"], "Collected notes"]);
  }
  return entries.map(([selectedText, note, tags, sourceTitle], index) => ({
    id: `store-card-${index + 1}`,
    selectedText, note: scene === "bulk" ? "" : note, tags, sourceTitle,
    sourceUrl: `https://example.org/notes/${index + 1}`,
    contextText: `From my reading notes: ${selectedText} A useful idea to return to later.`,
    status: scene === "library" && index === 1 ? "archived" : "current",
    createdAt: new Date(Date.UTC(2026, 7, 12 - index)).toISOString()
  }));
}

async function snapshotPopup(browser, scene) {
  const context = await browser.newContext({ viewport: { width: 430, height: 700 }, colorScheme: "light" });
  const errors = [];
  try {
    await context.addInitScript(({ cards, scene }) => {
      const data = {
        "phraselet.cards": cards,
        "phraselet.backupReminder": scene === "portability" ? {} : { lastBackupAt: new Date().toISOString() }
      };
      window.chrome = {
        storage: {
          local: {
            get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, data[key]])),
            set: async values => Object.assign(data, values)
          },
          onChanged: { addListener() {} }
        },
        runtime: { openOptionsPage() {}, sendMessage: async () => ({ ok: true }) }
      };
    }, { cards: fixtureCards(scene), scene });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(pathToFileURL(path.join(root, "popup.html")).href);
    await page.locator(".phrase-card").first().waitFor();
    if (scene === "library") {
      await page.locator("#view-filter").selectOption("");
      await page.locator("#search").fill("attention");
      assert.equal(await page.locator("#card-count").textContent(), "2 of 7 cards");
    } else if (scene === "bulk") {
      await page.locator("#toggle-selection").click();
      for (const id of ["store-card-1", "store-card-2"]) {
        await page.locator(`input[data-action="select-card"][data-id="${id}"]`).check();
      }
      assert.equal(await page.locator("#bulk-selection-count").textContent(), "2 selected");
      await page.locator("#bulk-more").click();
      assert.equal(await page.locator("#bulk-more-panel").isVisible(), true);
    } else if (scene === "collapsed") {
      await page.locator("#toggle-cards").click();
      assert.equal(await page.locator("#toggle-cards").textContent(), "Expand all");
      assert.equal(await page.locator(".card-footer").first().isVisible(), false);
    } else {
      assert.equal(await page.locator("#backup-reminder").isVisible(), true);
      await page.locator("#export-cards").click();
      assert.equal(await page.locator(".export-scope").textContent(), "All cards, including archived");
    }
    await page.evaluate(() => document.activeElement.blur());
    await page.mouse.move(0, 0);
    assert.deepEqual(errors, []);
    // Preserve live control state in a standalone, script-free HTML preview.
    const markup = await page.evaluate(scene => {
      for (const input of document.querySelectorAll("input")) {
        input.setAttribute("value", input.value);
        input.toggleAttribute("checked", input.checked);
      }
      for (const option of document.querySelectorAll("option")) option.toggleAttribute("selected", option.selected);
      const shell = document.createElement("section");
      shell.className = "popup-shell popup-mock";
      shell.innerHTML = document.body.innerHTML;
      for (const script of shell.querySelectorAll("script")) script.remove();
      for (const hidden of shell.querySelectorAll("[hidden], datalist")) hidden.remove();
      // Keep enough cards to fill the framing in each display mode.
      for (const card of [...shell.querySelectorAll(".phrase-card")].slice(scene === "collapsed" ? 5 : 2)) card.remove();
      return shell.outerHTML;
    }, scene);
    const source = `<!doctype html>
<!-- Generated from popup.html and src/popup.js by scripts/render-store-screenshots.cjs. -->
<html lang="en">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Phraselet ${scene} screenshot</title><link rel="stylesheet" href="../../src/shared.css"><link rel="stylesheet" href="store.css"></head>
  <body class="${scene}-demo">
    <main class="stage">
      <div class="browser-bar" aria-hidden="true"><span class="browser-dots"><i></i><i></i><i></i></span><div class="address"></div></div>
      <article class="page-copy"><span class="kicker">Phraselet</span><h1>${sceneCopy[scene][0]}</h1><p>${sceneCopy[scene][1]}</p></article>
      <div class="popup-wrap">${markup}</div>
    </main>
  </body>
</html>
`;
    await fs.writeFile(path.join(assets, "source", `${scene}.html`), source.replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n"));
  } finally {
    await context.close();
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true, args: ["--allow-file-access-from-files"] });
  try {
    for (const scene of ["library", "bulk", "portability", "collapsed"]) await snapshotPopup(browser, scene);
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, colorScheme: "light" });
    for (const [scene, master, upload] of scenes) {
      await page.goto(pathToFileURL(path.join(assets, "source", `${scene}.html`)).href);
      if (scene === "capture") {
        // Use the shipping toast implementation, including its text and styling.
        const background = await fs.readFile(path.join(root, "src/background.js"), "utf8");
        const start = background.indexOf("function displayCaptureToast(");
        const end = background.indexOf("\nasync function enrichCard(", start);
        assert(start >= 0 && end > start, "Could not find capture toast implementation");
        await page.locator("#phraselet-toast-host").evaluateAll(elements => elements.forEach(element => element.remove()));
        await page.evaluate(`(() => { ${background.slice(start, end)}\ndisplayCaptureToast('Saved "' + document.querySelector('mark').textContent + '"', 'success'); })()`);
        const toast = await page.locator("#phraselet-toast-host").evaluate(host => {
          clearTimeout(host.__phraseletToastTimer);
          return `<div id="phraselet-toast-host"><template shadowrootmode="open">${host.shadowRoot.innerHTML}</template></div>`;
        });
        const sourcePath = path.join(assets, "source", "capture.html");
        const source = await fs.readFile(sourcePath, "utf8");
        await fs.writeFile(sourcePath, source.replace(/<!-- Capture toast start -->[\s\S]*?<!-- Capture toast end -->/, `<!-- Capture toast start -->\n      ${toast}\n      <!-- Capture toast end -->`));
        await page.goto(pathToFileURL(sourcePath).href);
      }
      await page.evaluate(() => document.fonts.ready);
      const png = await page.screenshot({ animations: "disabled", type: "png" });
      await fs.writeFile(path.join(assets, "screenshots", `${master}.png`), png);
      const jpg = await sharp(png).flatten({ background: "#ffffff" }).jpeg({ quality: 95, chromaSubsampling: "4:4:4" }).toBuffer();
      await fs.writeFile(path.join(assets, "upload", `${upload}-1280x800.jpg`), jpg);
      if (scene === "capture") await fs.writeFile(path.join(assets, "upload", "phraselet-capture.jpg"), jpg);
      for (const [buffer, format] of [[png, "png"], [jpg, "jpeg"]]) {
        const metadata = await sharp(buffer).metadata();
        assert.equal(metadata.width, 1280);
        assert.equal(metadata.height, 800);
        assert.equal(metadata.format, format);
        assert.equal(metadata.hasAlpha, false);
      }
      console.log(`Rendered ${upload}: 1280 × 800 PNG master and JPEG upload`);
    }
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
