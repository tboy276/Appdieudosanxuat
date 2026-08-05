// Run this from the project directory so node_modules is in scope
import git from "isomorphic-git";
import fs from "fs";
import http from "isomorphic-git/http/node";

const dir = process.cwd();
console.log("Working dir:", dir);

async function main() {
  try {
    // Stage all changes
    await git.add({ fs, dir, filepath: "." });
    console.log("Staged all");

    // Check what's staged
    const statusMatrix = await git.statusMatrix({ fs, dir });
    const changed = statusMatrix.filter(([_, head, workdir, stage]) => stage !== head);
    console.log("Changed:", changed.length, "files");

    // Commit
    const sha = await git.commit({
      fs,
      dir,
      message: "fix: multi-line PO - createWOsForPO join, deduplication, test isolation",
      author: { name: "Antigravity", email: "antigravity@dev.local" },
    });
    console.log("Committed:", sha);

    // List remotes
    const remotes = await git.listRemotes({ fs, dir });
    console.log("Remotes:", JSON.stringify(remotes));

    // Push
    const result = await git.push({
      fs,
      http,
      dir,
      onAuth: () => ({ username: process.env.GITHUB_TOKEN || "" }),
    });
    console.log("Push result:", JSON.stringify(result));
  } catch (e: any) {
    console.error("Error:", e.message || e);
  }
}

main();
