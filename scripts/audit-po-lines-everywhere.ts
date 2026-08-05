import fs from "fs";
import path from "path";

const rootDir = path.resolve(__dirname, "..");

function scanDir(dir: string, fileList: string[] = []): string[] {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    if (file === "node_modules" || file === ".next" || file === ".git") continue;
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      scanDir(fullPath, fileList);
    } else if (file.endsWith(".ts") || file.endsWith(".tsx") || file.endsWith(".js")) {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

const allFiles = scanDir(rootDir);
console.log(`Scanning ${allFiles.length} files for po_lines and line patterns...\n`);

const findings: { file: string; lineNo: number; line: string }[] = [];

for (const file of allFiles) {
  const content = fs.readFileSync(file, "utf-8");
  const lines = content.split("\n");
  lines.forEach((l, idx) => {
    if (
      l.includes("po_lines") ||
      l.includes("po_line_id") ||
      l.includes(".po_lines[0]") ||
      l.includes("po_lines[0]") ||
      l.includes(".lines[0]") ||
      l.includes("createWOsForPO") ||
      l.includes("getPipelineReport") ||
      l.includes("getShippableItems") ||
      l.includes("deletePO") ||
      l.includes("updatePO")
    ) {
      const relPath = path.relative(rootDir, file);
      findings.push({ file: relPath, lineNo: idx + 1, line: l.trim() });
    }
  });
}

console.log(`Found ${findings.length} matching lines.`);
findings.forEach((f) => {
  console.log(`[${f.file}:${f.lineNo}] ${f.line}`);
});
