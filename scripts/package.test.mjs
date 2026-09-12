import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { verifyRegistryInstallation } from "./verify-publication.mjs";
import { execFileSync, execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { expectedName, verifyPackage } from "./verify-package.mjs";

const root = path.resolve(import.meta.dirname, "..");
test("actual npm tarball inventory and rejection of tampered publication metadata", async () => {
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
    if (expectedName === "@openaxes/opencode-governance") {
      const { loadPiSdkPayload } = await import(pathToFileURL(path.join(temporary, "package/dist/pi/sdk.mjs")).href);
      await assert.rejects(loadPiSdkPayload(), { code: "ERR_MODULE_NOT_FOUND" });
      const alias = path.join(temporary, "node_modules/pi-subagents");
      mkdirSync(alias, { recursive: true });
      writeFileSync(path.join(alias, "index.js"), "export default {};\n");
      for (const [name, version] of [["pi-subagents", "0.66.0"], ["@openaxes/pi-subagents", "0.67.0"]]) {
        writeFileSync(path.join(alias, "package.json"), JSON.stringify({ name, version, type: "module", exports: "./index.js" }));
        await assert.rejects(loadPiSdkPayload(), /PI_SDK_PACKAGE_IDENTITY_MISMATCH/);
      }
    }
    const installDirectory = path.join(temporary, "install");
    const installedManifest = path.join(installDirectory, "node_modules", expectedName, "package.json");
    mkdirSync(path.dirname(installedManifest), { recursive: true });
    writeFileSync(installedManifest, JSON.stringify(original));
    const metadataFile = path.join(temporary, "registry.json");
    const packMetadataFile = path.join(temporary, "pack.json");
    writeFileSync(metadataFile, JSON.stringify({ name: expectedName, version, dist: { tarball: "https://npm.pkg.github.com/download/fixture" } }));
    writeFileSync(packMetadataFile, JSON.stringify(metadata));
    const expectedSha256 = createHash("sha256").update(readFileSync(path.join(temporary, filename))).digest("hex");
    const verification = { metadataFile, packMetadataFile, downloadDirectory: temporary, installDirectory, expectedSha256, version };
    assert.equal(await verifyRegistryInstallation(verification), expectedSha256);
    await assert.rejects(verifyRegistryInstallation({ ...verification, expectedSha256: "0".repeat(64) }), /Registry bytes differ/);
    writeFileSync(installedManifest, JSON.stringify({ ...original, version: "99.99.99" }));
    await assert.rejects(verifyRegistryInstallation(verification), /Wrong installed package version/);
    writeFileSync(installedManifest, JSON.stringify(original));
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
