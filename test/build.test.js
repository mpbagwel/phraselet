const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { execFileSync } = require("node:child_process");

const projectRoot = path.resolve(__dirname, "..");
const packageScript = path.join(projectRoot, "scripts/package-extension.sh");

test("base and AI development packages enforce their capability boundaries", () => {
  execFileSync("sh", [packageScript, "base"], { cwd: projectRoot });
  execFileSync("sh", [packageScript, "ai-dev"], { cwd: projectRoot });

  const baseRoot = path.join(projectRoot, "dist/phraselet-base");
  const aiRoot = path.join(projectRoot, "dist/phraselet-ai-dev");
  const baseManifest = readJson(path.join(baseRoot, "manifest.json"));
  const aiManifest = readJson(path.join(aiRoot, "manifest.json"));
  const baseFeatures = read(path.join(baseRoot, "src/features.js"));
  const aiFeatures = read(path.join(aiRoot, "src/features.js"));
  const baseOptions = read(path.join(baseRoot, "options.html"));
  const baseOnboarding = read(path.join(baseRoot, "onboarding.html"));
  const baseRuntimeSources = listFiles(path.join(baseRoot, "src"))
    .map(read)
    .join("\n");

  assert.equal(baseManifest.host_permissions, undefined);
  assert.equal(baseManifest.permissions.includes("clipboardWrite"), false);
  assert.match(baseFeatures, /aiEnrichment: false/);
  assert.equal(fs.existsSync(path.join(baseRoot, "src/enrichment")), false);
  assert.equal(fs.existsSync(path.join(baseRoot, "src/backup.js")), true);
  assert.doesNotMatch(baseOptions, /api-key|OpenAI|AI explanations/i);
  assert.doesNotMatch(baseOnboarding, /OpenAI|AI explanations/i);
  assert.doesNotMatch(
    baseRuntimeSources,
    /OpenAI|api\.openai\.com|gpt-4|sk-|AI explanations|Add an .* API key/i
  );

  assert.deepEqual(aiManifest.host_permissions, ["https://api.openai.com/*"]);
  assert.equal(fs.existsSync(path.join(aiRoot, "src/backup.js")), true);
  assert.match(aiFeatures, /aiEnrichment: true/);
  assert.equal(fs.existsSync(path.join(aiRoot, "src/enrichment/openai.js")), true);
  assert.equal(fs.existsSync(path.join(aiRoot, "src/enrichment/options.js")), true);
});

function read(filename) {
  return fs.readFileSync(filename, "utf8");
}

function readJson(filename) {
  return JSON.parse(read(filename));
}

function listFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(filename) : [filename];
  });
}
