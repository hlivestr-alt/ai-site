import { readFile, readdir } from "node:fs/promises";
import { resolve, extname, relative, sep } from "node:path";

const ownedRoot = resolve(import.meta.dirname, "../..");
const extensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".jsonl", ".md", ".txt", ".log", ".yaml", ".yml", ".toml", ".ps1", ".css", ".html", ".map", ".svg"]);
const legacy = new RegExp(String.fromCharCode(112, 114, 111, 121, 97), "gi");
const findings = [], brandFiles = [];
const browserLeaks = [];
const envText = await readFile(resolve(ownedRoot, "app/.env.local"), "utf8");
const secrets = envText.split(/\r?\n/).flatMap(line => {
  const match = /^([A-Z_]+)=(.*)$/.exec(line);
  if (!match || !/SECRET|PASSWORD|TOKEN|DATABASE_URL/.test(match[1])) return [];
  const value = match[2].trim().replace(/^['"]|['"]$/g, "");
  return value.length >= 16 ? [value] : [];
});
let inspected = 0, legacyMatches = 0;
async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || ["node_modules", ".git"].includes(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (!path.startsWith(ownedRoot + sep)) throw new Error("Outside owned root");
    if (entry.isDirectory()) { await visit(path); continue; }
    if (!extensions.has(extname(path)) && !entry.name.startsWith(".env")) continue;
    const bytes = await readFile(path);
    if (bytes.includes(0)) continue;
    const content = bytes.toString("utf8");
    inspected++;
    let secretLike = /--token(?:\s+|=)["']?[A-Za-z0-9_\-/+=]{80,}/.test(content)
      || /(?:CLOUDFLARE|CLOUDFLARED|TUNNEL)_(?:API_)?TOKEN\s*[:=]\s*["']?[A-Za-z0-9_\-/+=]{40,}/i.test(content);
    // Token-based tunnels encode account/tunnel/secret fields in base64 JSON.
    for (const candidate of content.matchAll(/\beyJ[A-Za-z0-9_\-/+=]{77,}/g)) {
      try {
        const data = JSON.parse(Buffer.from(candidate[0], "base64").toString("utf8"));
        if (data && typeof data === "object" && typeof data.a === "string" && typeof data.t === "string" && typeof data.s === "string") secretLike = true;
      } catch { /* Other base64 data is not a tunnel token. */ }
    }
    if (secretLike) findings.push(relative(ownedRoot, path));
    if (path.startsWith(resolve(ownedRoot, "app/.next/static") + sep) && secrets.some(secret => content.includes(secret))) browserLeaks.push(relative(ownedRoot, path));
    const segments = relative(ownedRoot, path).split(sep);
    if (["app", "h3-bridge"].includes(segments[0]) && !segments.some(part => ["data", ".next", "dist", "test-results", "playwright-report"].includes(part)) && !entry.name.endsWith(".log") && !entry.name.startsWith(".env") && !entry.name.endsWith(".tsbuildinfo")) {
      const matches = content.match(legacy)?.length ?? 0;
      legacyMatches += matches;
      if (matches) brandFiles.push({ file: relative(ownedRoot, path), matches });
    }
  }
}
for (const area of ["app", "h3-bridge", "validation"]) await visit(resolve(ownedRoot, area));
console.log(JSON.stringify({ inspectedTextFiles: inspected, cloudflareTokenPersisted: findings.length > 0, filesRequiringCleanup: findings, browserSecretLeaks: browserLeaks, oldBrandSourceMatches: legacyMatches, brandFiles }, null, 2));
if (findings.length || legacyMatches || browserLeaks.length) process.exitCode = 1;
