import fs from "fs";
import path from "path";

const rootDir = path.resolve(__dirname, "..");
function searchWord(dir: string, word: string) {
  const files = fs.readdirSync(dir);
  for (const f of files) {
    if (f === "node_modules" || f === ".next" || f === ".git") continue;
    const full = path.join(dir, f);
    if (fs.statSync(full).isDirectory()) {
      searchWord(full, word);
    } else if (f.endsWith(".ts") || f.endsWith(".tsx")) {
      const c = fs.readFileSync(full, "utf-8");
      if (c.includes(word)) {
        console.log(`Match in: ${path.relative(rootDir, full)}`);
      }
    }
  }
}

searchWord(rootDir, "WO-");
