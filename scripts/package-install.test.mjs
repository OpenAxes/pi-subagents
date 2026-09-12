import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { expectedName, verifyPackage } from "./verify-package.mjs";
import { summarizeNpmFailure } from "./verify-publication.mjs";

// Genuine npm installation, not extraction or a manually constructed dependency tree.
test("npm installs the exact verified tarball with scripts disabled and optional SDK peers absent", () => {
  const temporary = mkdtempSync(path.join(tmpdir(), "openaxes-npm-install-"));
  try {
    const root = path.resolve(import.meta.dirname, "..");
    const [packed] = JSON.parse(execSync(`npm pack --json --ignore-scripts --pack-destination "${temporary}"`, { cwd: root, encoding: "utf8" }));
    const tarball = path.join(temporary, packed.filename);
    verifyPackage(tarball, packed.version);
    const consumer = path.join(temporary, "consumer");
    mkdirSync(consumer);
    writeFileSync(path.join(consumer, "package.json"), JSON.stringify({ private: true }));
    writeFileSync(path.join(consumer, ".npmrc"), ["registry=https://registry.npmjs.org", "@openaxes:registry=https://npm.pkg.github.com", ""].join("\n"));
    try {
      execSync(`npm install --json --ignore-scripts --no-audit --no-fund --save-exact "${tarball}"`, { cwd: consumer, encoding: "utf8", stdio: "pipe", timeout: 120000 });
    } catch (error) {
      throw new Error(`npm install failed: ${JSON.stringify(summarizeNpmFailure(String(error.stdout ?? ""), String(error.stderr ?? "")))}`);
    }
    const installed = JSON.parse(readFileSync(path.join(consumer, "node_modules", expectedName, "package.json"), "utf8"));
    assert.equal(installed.name, expectedName);
    assert.equal(installed.version, packed.version);
    assert.equal(installed.publishConfig.registry, "https://npm.pkg.github.com");
    assert.equal(installed.publishConfig.access, "restricted");
    assert(!existsSync(path.join(consumer, "node_modules/@earendil-works/pi-coding-agent")), "Unused host SDK must remain optional");
    if (expectedName === "@openaxes/opencode-governance") assert(!existsSync(path.join(consumer, "node_modules/pi-subagents")), "Unused private fork must remain optional");
    const lock = JSON.parse(readFileSync(path.join(consumer, "package-lock.json"), "utf8"));
    assert.equal(lock.packages[`node_modules/${expectedName}`].version, packed.version);
    console.log(JSON.stringify({ name: installed.name, version: installed.version, actualNpmInstall: true, dependencyEntries: Object.keys(lock.packages).length - 1 }));
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
