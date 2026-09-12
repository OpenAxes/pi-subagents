import assert from "node:assert/strict";
import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { expectedName, verifyPackage } from "./verify-package.mjs";

const root = path.resolve(import.meta.dirname, "..");
test("actual npm tarball inventory and rejection of tampered publication metadata", () => {
  const temporary = mkdtempSync(path.join(tmpdir(), "openaxes-tarball-test-"));
  try {
    const metadata = JSON.parse(execSync(`npm pack --json --ignore-scripts --pack-destination "${temporary}"`, { cwd: root, encoding: "utf8" }));
    assert.equal(metadata.length, 1);
    const { filename, version, name } = metadata[0];
    assert.equal(name, expectedName);
    assert.equal(verifyPackage(path.join(temporary, filename), version).name, expectedName);
    assert.throws(() => verifyPackage(path.join(temporary, filename), "99.99.99"), /Wrong publication version/);
    execFileSync("tar", ["-xzf", filename], { cwd: temporary });
    const packagePath = path.join(temporary, "package/package.json");
    const original = JSON.parse(readFileSync(packagePath, "utf8"));
    for (const [changes, message] of [
      [{ name: "pi-subagents" }, /Wrong publication identity/],
      [{ publishConfig: { registry: "https://registry.npmjs.org", access: "restricted" } }, /Wrong publication registry/],
      [{ publishConfig: { registry: "https://npm.pkg.github.com", access: "public" } }, /must be restricted/],
      [{ exports: { ".": "./missing.js" } }, /Missing entrypoint/],
      [{ bundledDependencies: ["pi-subagents"] }, /Do not bundle/],
    ]) {
      writeFileSync(packagePath, JSON.stringify({ ...original, ...changes }));
      execFileSync("tar", ["-czf", "tampered.tgz", "package"], { cwd: temporary });
      assert.throws(() => verifyPackage(path.join(temporary, "tampered.tgz"), version), message);
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
