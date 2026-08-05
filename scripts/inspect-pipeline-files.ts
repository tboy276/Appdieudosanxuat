import fs from "fs";
import path from "path";

const rootDir = path.resolve(__dirname, "..");
const files = ["lib/pipeline.ts", "lib/pipeline-postgres.ts", "app/api/pipeline/route.ts", "app/dashboard/pipeline/page.tsx"];

files.forEach((f) => {
  const full = path.join(rootDir, f);
  if (fs.existsSync(full)) {
    console.log(`=== FILE: ${f} ===`);
    console.log(fs.readFileSync(full, "utf-8").substring(0, 2000));
  }
});
