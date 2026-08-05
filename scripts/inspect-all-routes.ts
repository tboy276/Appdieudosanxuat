import fs from "fs";
import path from "path";

const apiDir = path.resolve(process.cwd(), "app/api");

function getAllRouteFiles(dir: string): string[] {
  let results: string[] = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getAllRouteFiles(fullPath));
    } else if (file === "route.ts") {
      results.push(fullPath);
    }
  }
  return results;
}

const routes = getAllRouteFiles(apiDir);
console.log(`Found ${routes.length} route files:`);

for (const routePath of routes) {
  const relPath = path.relative(process.cwd(), routePath).replace(/\\/g, "/");
  const content = fs.readFileSync(routePath, "utf8");
  
  // Extract imports
  const imports = content
    .split("\n")
    .filter((l) => l.startsWith("import "))
    .map((l) => l.trim());

  // Extract exported functions (GET, POST, PUT, DELETE, PATCH)
  const handlers = ["GET", "POST", "PUT", "DELETE", "PATCH"].filter((m) =>
    new RegExp(`export\\s+async\\s+function\\s+${m}\\b|export\\s+function\\s+${m}\\b`).test(content)
  );

  console.log("\n=======================================================");
  console.log(`ROUTE: ${relPath}`);
  console.log(`HANDLERS: ${handlers.join(", ")}`);
  console.log("IMPORTS:");
  imports.forEach((imp) => console.log(`  ${imp}`));

  // Check if any redis import or suspicious in-memory pattern exists
  if (content.includes("redis") || content.includes("Redis")) {
    console.log("  ⚠️ WARNING: Contains 'redis' string!");
  }
}
