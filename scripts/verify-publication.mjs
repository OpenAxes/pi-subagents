import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expectedName, verifyPackage } from "./verify-package.mjs";

export async function lookupExactPackage(request, name) {
  const url = `https://api.github.com/orgs/OpenAxes/packages/npm/${encodeURIComponent(name.split("/")[1])}`;
  const response = await request(url);
  if (response.status === 404) return null;
  if (!response.ok) {
    const error = new Error(`GitHub package metadata lookup failed: ${response.status}`);
    error.httpStatus = response.status;
    throw error;
  }
  return response.json();
}

export function requirePrivatePackage(pkg, name, repository) {
  assert(pkg, "Published package is not visible to the workflow token");
  assert(pkg.name === name || pkg.name === name.split("/")[1], "Wrong GitHub package identity");
  assert.equal(pkg.package_type, "npm", "Wrong GitHub package type");
  assert.equal(pkg.visibility, "private", "GitHub package must actually be PRIVATE");
  assert.equal(pkg.repository?.full_name?.toLowerCase(), repository.toLowerCase(), "Wrong GitHub package repository linkage");
  return { name, visibility: pkg.visibility, repository: pkg.repository.full_name };
}

export async function verifyRegistryInstallation(options) {
  const registry = JSON.parse(await readFile(options.metadataFile, "utf8"));
  assert.equal(registry.name, expectedName, "Wrong registry package name");
  assert.equal(registry.version, options.version, "Wrong registry package version");
  const downloadUrl = new URL(registry.dist.tarball);
  assert(downloadUrl.protocol === "https:" && downloadUrl.hostname === "npm.pkg.github.com" && !downloadUrl.username && !downloadUrl.password, "Unexpected registry tarball origin");
  const packed = JSON.parse(await readFile(options.packMetadataFile, "utf8"));
  assert(Array.isArray(packed) && packed.length === 1, "Expected one registry download");
  const filename = packed[0].filename;
  assert(typeof filename === "string" && path.basename(filename) === filename && /^[A-Za-z0-9._-]+\.tgz$/.test(filename), "Unsafe downloaded filename");
  const tarball = path.join(options.downloadDirectory, filename);
  const digest = createHash("sha256").update(await readFile(tarball)).digest("hex");
  assert.equal(digest, options.expectedSha256, "Registry bytes differ from the validated release artifact");
  verifyPackage(tarball, options.version);
  const installed = JSON.parse(await readFile(path.join(options.installDirectory, "node_modules", expectedName, "package.json"), "utf8"));
  assert.equal(installed.name, expectedName, "Wrong installed package identity");
  assert.equal(installed.version, options.version, "Wrong installed package version");
  assert.equal(installed.publishConfig?.registry, "https://npm.pkg.github.com");
  assert.equal(installed.publishConfig?.access, "restricted");
  return digest;
}

async function main(mode) {
  assert(["initialize", "blocked", "verify"].includes(mode), "Expected initialize, blocked or verify mode");
  const metadata = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const repository = `OpenAxes/${expectedName.split("/")[1]}`;
  assert.equal(process.env.GITHUB_REPOSITORY?.toLowerCase(), repository.toLowerCase(), "Unexpected release repository");
  assert(process.env.NODE_AUTH_TOKEN, "Missing job-scoped package token");
  assert.equal(process.env.PUBLISH_SUCCEEDED, "true", "Publication success was not recorded by the publishing step");
  const receipt = { phase: mode, name: expectedName, version: metadata.version, registry: "https://npm.pkg.github.com", publicationSucceeded: true, verified: false };
  const receiptPath = path.join(process.env.RUNNER_TEMP, "private-publication.json");
  if (mode === "initialize") {
    receipt.status = "publication-succeeded; verification-pending";
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}
`);
    return;
  }
  if (mode === "blocked") {
    const previous = JSON.parse(await readFile(receiptPath, "utf8"));
    await writeFile(receiptPath, `${JSON.stringify({ ...previous, phase: process.env.VERIFICATION_PHASE, verified: false, status: "publication-succeeded; verification-blocked" }, null, 2)}
`);
    return;
  }
  try {
    const lookup = () => lookupExactPackage(url => fetch(url, {
      headers: { Authorization: `Bearer ${process.env.NODE_AUTH_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    }), expectedName);
    let pkg = await lookup();
    for (let attempt = 0; !pkg && attempt < 4; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 3000));
      pkg = await lookup();
    }
    if (!pkg) receipt.httpStatus = 404;
    Object.assign(receipt, requirePrivatePackage(pkg, expectedName, repository));
    const digest = await verifyRegistryInstallation({
        metadataFile: process.env.REGISTRY_PACKAGE_METADATA_FILE,
        packMetadataFile: process.env.REGISTRY_PACK_METADATA_FILE,
        downloadDirectory: process.env.REGISTRY_DOWNLOAD_DIRECTORY,
        installDirectory: process.env.REGISTRY_INSTALL_DIRECTORY,
        expectedSha256: process.env.EXPECTED_PACKAGE_SHA256,
        version: metadata.version,
      });
    Object.assign(receipt, { status: "private-publication-verified", verified: true, registryTarballSha256: digest, registryDownloadVerified: true, installationVerified: true });
  } catch (error) {
    receipt.status = "publication-succeeded; verification-blocked";
    if (error.httpStatus) receipt.httpStatus = error.httpStatus;
    receipt.error = error.message;
    throw error;
  } finally {
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    console.log(JSON.stringify(receipt));
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) await main(process.argv[2]);
