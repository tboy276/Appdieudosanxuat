import fs from "fs";
import path from "path";

const projectRoot = path.resolve(__dirname, "..");
const ignoredDirs = [".next", "node_modules", ".git", ".gemini", ".agents"];

const redisKeywords = [
  "@upstash/redis",
  "ioredis",
  "redis",
  "UPSTASH",
  "po_shipped_qty",
  "po-engine.ts",
  "wo-engine.ts",
  "xnt-engine.ts"
];

const results: { file: string; line: number; text: string; keyword: string }[] = [];

function scanDirectory(dir: string) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(projectRoot, fullPath);

    if (entry.isDirectory()) {
      if (ignoredDirs.includes(entry.name)) continue;
      scanDirectory(fullPath);
    } else if (entry.isFile()) {
      if (relPath.endsWith(".ts") || relPath.endsWith(".tsx") || relPath.endsWith(".json") || relPath.endsWith(".env") || relPath.endsWith(".env.local")) {
        const content = fs.readFileSync(fullPath, "utf8");
        const lines = content.split("\n");

        lines.forEach((lineText, idx) => {
          for (const kw of redisKeywords) {
            if (lineText.toLowerCase().includes(kw.toLowerCase())) {
              results.push({
                file: relPath.replace(/\\/g, "/"),
                line: idx + 1,
                text: lineText.trim(),
                keyword: kw,
              });
              break;
            }
          }
        });
      }
    }
  }
}

scanDirectory(projectRoot);

console.log(`Scan completed. Found ${results.length} references to Redis/Upstash:\n`);

const fileGroups: Record<string, typeof results> = {};
results.forEach((r) => {
  if (!fileGroups[r.file]) fileGroups[r.file] = [];
  fileGroups[r.file].push(r);
});

Object.entries(fileGroups).forEach(([file, refs]) => {
  console.log(`File: ${file} (${refs.length} occurrences)`);
  refs.slice(0, 5).forEach((ref) => {
    console.log(`  Line ${ref.line}: ${ref.text}`);
  });
  if (refs.length > 5) {
    console.log(`  ... and ${refs.length - 5} more lines`);
  }
  console.log("");
});
