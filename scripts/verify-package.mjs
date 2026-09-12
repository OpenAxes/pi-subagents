import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

export const expectedName = "@openaxes/pi-subagents";
export function verifyPackage(tarball, version) {
  const files = execFileSync("tar", ["-tzf", path.basename(tarball)], { cwd: path.dirname(path.resolve(tarball)), encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }).trim().split(/\r?\n/);
  assert(files.every(file => file.startsWith("package/") && !file.split("/").includes("..")), "Unsafe tarball paths");
  assert.equal(new Set(files).size, files.length, "Duplicate tarball paths");
  const pkg = JSON.parse(execFileSync("tar", ["-xOf", path.basename(tarball), "package/package.json"], { cwd: path.dirname(path.resolve(tarball)), encoding: "utf8" }));
  assert.equal(pkg.name, expectedName, "Wrong publication identity");
  assert.equal(pkg.version, version, "Wrong publication version");
  assert.equal(pkg.publishConfig?.registry, "https://npm.pkg.github.com", "Wrong publication registry");
  assert.equal(pkg.publishConfig?.access, "restricted", "Publication must be restricted");
  assert(!pkg.private, "Root package cannot prohibit its intended publication");
  assert(!pkg.bundledDependencies?.length && !pkg.bundleDependencies?.length, "Do not bundle host/dependency graphs");
  assert(!files.some(file => /\/(?:node_modules|coverage|tests?|logs|\.git)\//.test(file) || /\.(?:test|spec)\.[cm]?[jt]s$/.test(file) || /\/(?:\.npmrc|cli\.mjs|package-lock\.json)$/.test(file)), "Unexpected private/test/dependency payload");
  for (const target of [...Object.values(pkg.exports), ...Object.values(pkg.bin ?? {})]) {
    assert.equal(typeof target, "string");
    assert(files.includes(`package/${target.replace(/^\.\//, "")}`), `Missing entrypoint: ${target}`);
  }
  assert.equal(pkg.bin, undefined, "Do not expose the historical upstream Git installer");
  assert(!files.includes("package/install.mjs"), "Historical upstream Git installer must not ship");
  return { name: pkg.name, version: pkg.version, files: files.length };
}
if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const version = process.argv[3] ?? JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
  console.log(JSON.stringify(verifyPackage(process.argv[2], version)));
}
