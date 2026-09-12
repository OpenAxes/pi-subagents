import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { verifyPackage } from "./verify-package.mjs";

const root = path.resolve(import.meta.dirname, "..");
const temporary = mkdtempSync(path.join(tmpdir(), "openaxes-package-"));
try {
  // Build is a separate required gate; packing must not rebuild after validation.
  const command = `npm pack --json --ignore-scripts --pack-destination "${temporary}"`;
  const output = execSync(command, { cwd: root, encoding: "utf8" });
  const metadata = JSON.parse(output);
  if (!Array.isArray(metadata) || metadata.length !== 1) throw new Error("Expected exactly one tarball");
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  console.log(JSON.stringify(verifyPackage(path.join(temporary, metadata[0].filename), pkg.version)));
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
