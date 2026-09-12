import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expectedName } from "./verify-package.mjs";
import { lookupExactPackage, requirePrivatePackage } from "./verify-publication.mjs";

const name = "@openaxes/example";
const repository = "OpenAxes/example";
const privatePackage = { name, package_type: "npm", visibility: "private", repository: { full_name: repository } };

test("exact organization package metadata lookup preserves authorization failures", async () => {
  const found = await lookupExactPackage(async url => {
    assert.equal(url, "https://api.github.com/orgs/OpenAxes/packages/npm/example");
    return { ok: true, status: 200, json: async () => privatePackage };
  }, name);
  assert.equal(found, privatePackage);
  assert.equal(await lookupExactPackage(async () => ({ ok: false, status: 404 }), name), null);
  await assert.rejects(lookupExactPackage(async () => ({ ok: false, status: 403 }), name), { message: "GitHub package metadata lookup failed: 403", httpStatus: 403 });
});

test("failure receipt distinguishes a published version without exposing authentication", () => {
  const temporary = mkdtempSync(path.join(tmpdir(), "private-publication-receipt-"));
  const env = { ...process.env, RUNNER_TEMP: temporary, GITHUB_REPOSITORY: `OpenAxes/${expectedName.split("/")[1]}`, PUBLISH_SUCCEEDED: "true", NODE_AUTH_TOKEN: "synthetic-fixture-only", VERIFICATION_PHASE: "registry-install" };
  try {
    for (const mode of ["initialize", "blocked"]) execFileSync(process.execPath, [path.join(import.meta.dirname, "verify-publication.mjs"), mode], { env });
    const raw = readFileSync(path.join(temporary, "private-publication.json"), "utf8");
    const receipt = JSON.parse(raw);
    assert.equal(receipt.publicationSucceeded, true);
    assert.equal(receipt.verified, false);
    assert.equal(receipt.status, "publication-succeeded; verification-blocked");
    assert.equal(receipt.phase, "registry-install");
    assert(!raw.includes(env.NODE_AUTH_TOKEN));
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("only actual PRIVATE visibility and exact repository linkage pass", () => {
  assert.equal(requirePrivatePackage(privatePackage, name, repository).visibility, "private");
  assert.equal(requirePrivatePackage({ ...privatePackage, name: "example" }, name, repository).visibility, "private");
  for (const candidate of [null, { ...privatePackage, visibility: "public" }, { ...privatePackage, visibility: "internal" }, { ...privatePackage, name: "other" }, { ...privatePackage, repository: { full_name: "OpenAxes/other" } }, { ...privatePackage, repository: undefined }]) {
    assert.throws(() => requirePrivatePackage(candidate, name, repository));
  }
});
