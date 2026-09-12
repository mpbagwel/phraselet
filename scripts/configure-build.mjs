import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const [stagingDirectory, flavor] = process.argv.slice(2);
if (!stagingDirectory || !["base", "ai-dev"].includes(flavor)) {
  throw new Error("Usage: configure-build.mjs <staging-directory> <base|ai-dev>");
}

const aiEnrichment = flavor === "ai-dev";
const manifestPath = path.join(stagingDirectory, "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

if (aiEnrichment) {
  manifest.description = "Save words and phrases from the web with source context and optional AI explanations.";
  manifest.host_permissions = ["https://api.openai.com/*"];
} else {
  delete manifest.host_permissions;
  fs.rmSync(path.join(stagingDirectory, "src", "enrichment"), {
    recursive: true,
    force: true
  });
}

fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
fs.writeFileSync(
  path.join(stagingDirectory, "src", "features.js"),
  aiEnrichment
    ? `export const FEATURES = Object.freeze({\n  aiEnrichment: true\n});\n\nexport async function loadEnrichmentRuntime() {\n  return import(\"./enrichment/background.js\");\n}\n\nexport async function loadEnrichmentOptions() {\n  return import(\"./enrichment/options.js\");\n}\n\nexport async function loadEnrichmentOnboarding() {\n  return import(\"./enrichment/onboarding.js\");\n}\n`
    : `export const FEATURES = Object.freeze({\n  aiEnrichment: false\n});\n\nexport async function loadEnrichmentRuntime() {\n  return null;\n}\n\nexport async function loadEnrichmentOptions() {\n  return null;\n}\n\nexport async function loadEnrichmentOnboarding() {\n  return null;\n}\n`
);
