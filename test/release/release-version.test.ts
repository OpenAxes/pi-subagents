import { afterEach, describe, expect, test } from "bun:test"
import { execFile } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { releaseVersionCli, verifyReleaseVersion } from "../../scripts/verify-release-version"

const execFileAsync = promisify(execFile)
const temporaryDirectories: string[] = []

async function git(args: string[], cwd: string): Promise<string> {
  return (await execFileAsync("git", args, { cwd, encoding: "utf8", windowsHide: true })).stdout.trim()
}

function releaseMetadata(version?: string) {
  return { name: "@openaxes/pi-subagents", publishConfig: { access: "restricted", registry: "https://npm.pkg.github.com" }, version }
}

async function releaseRepository(version = "0.3.0"): Promise<{ head: string; root: string; tagObjectId: string }> {
  const root = await mkdtemp(join(tmpdir(), "opencode-governance-release-"))
  temporaryDirectories.push(root)
  await git(["init", "-b", "main"], root)
  await git(["config", "user.name", "Release Test"], root)
  await git(["config", "user.email", "release@example.invalid"], root)
  await writeFile(join(root, "package.json"), JSON.stringify(releaseMetadata(version)), "utf8")
  await git(["add", "package.json"], root)
  await git(["commit", "-m", "release candidate"], root)
  const head = await git(["rev-parse", "HEAD"], root)
  await git(["update-ref", "refs/remotes/origin/main", head], root)
  await git(["tag", "-a", `v${version}`, "-m", `Release v${version}`], root)
  const tagObjectId = await git(["rev-parse", `refs/tags/v${version}`], root)
  return { head, root, tagObjectId }
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })))
})

describe("release version provenance", () => {
  test("rejects malformed or untrusted dispatch inputs before reading the repository", async () => {
    await expect(verifyReleaseVersion(undefined, "0".repeat(40), "refs/heads/main", { repository: "." })).rejects.toThrow(
      "release tag argument",
    )
    await expect(
      verifyReleaseVersion("v0.3.0; echo injected", "0".repeat(40), "refs/heads/main", { repository: "." }),
    ).rejects.toThrow(
      "strict Semantic Version",
    )
    await expect(verifyReleaseVersion("v0.3.0", "main", "refs/heads/main", { repository: "." })).rejects.toThrow(
      "full GitHub commit SHA",
    )
    await expect(
      verifyReleaseVersion("v0.3.0", "0".repeat(40), "refs/heads/main", {
        expectedTagObjectId: "main",
        repository: ".",
      }),
    ).rejects.toThrow("full tag object ID")
    await expect(verifyReleaseVersion("v0.3.0", "0".repeat(40), "refs/tags/v0.3.0", { repository: "." })).rejects.toThrow(
      "only from refs/heads/main",
    )
  })

  test("rejects upstream identity, public registry and unrestricted access", async () => {
    const { root, head } = await releaseRepository()
    const expected = releaseMetadata("0.3.0")
    for (const metadata of [
      { ...expected, name: "pi-subagents" },
      { ...expected, publishConfig: { ...expected.publishConfig, registry: "https://registry.npmjs.org" } },
      { ...expected, publishConfig: { ...expected.publishConfig, access: "public" } },
    ]) {
      await writeFile(join(root, "package.json"), JSON.stringify(metadata))
      await expect(verifyReleaseVersion("v0.3.0", head, "refs/heads/main", { repository: root })).rejects.toThrow("exact private OpenAxes")
    }
  })

  test("rejects numeric prerelease identifiers with leading zeroes", async () => {
    await expect(verifyReleaseVersion("v1.2.3-01", "0".repeat(40), "refs/heads/main", { repository: "." })).rejects.toThrow(
      "strict Semantic Version",
    )
    await expect(
      verifyReleaseVersion("v1.2.3-alpha.01", "0".repeat(40), "refs/heads/main", { repository: "." }),
    ).rejects.toThrow("strict Semantic Version")
  })

  test("accepts only an exact annotated package-version tag at current origin/main", async () => {
    const { head, root, tagObjectId } = await releaseRepository()
    await expect(
      verifyReleaseVersion("v0.3.0", head, "refs/heads/main", { expectedTagObjectId: tagObjectId, repository: root }),
    ).resolves.toEqual({ commitSha: head, tag: "v0.3.0", tagObjectId, version: "0.3.0" })
    expect(JSON.parse(await releaseVersionCli(["v0.3.0", head, "refs/heads/main", tagObjectId], { repository: root }))).toEqual({
      commitSha: head,
      tag: "v0.3.0",
      tagObjectId,
      version: "0.3.0",
    })

    await writeFile(join(root, "package.json"), JSON.stringify(releaseMetadata()), "utf8")
    await expect(verifyReleaseVersion("v0.3.0", head, "refs/heads/main", { repository: root })).rejects.toThrow("missing a version")
    await writeFile(join(root, "package.json"), JSON.stringify(releaseMetadata("0.3.1")), "utf8")
    await expect(verifyReleaseVersion("v0.3.0", head, "refs/heads/main", { repository: root })).rejects.toThrow(
      "does not match package version",
    )
    await writeFile(join(root, "package.json"), JSON.stringify(releaseMetadata("0.3.0")), "utf8")

    await git(["tag", "-d", "v0.3.0"], root)
    await git(["symbolic-ref", "refs/tags/v0.3.0", "refs/heads/main"], root)
    await expect(verifyReleaseVersion("v0.3.0", head, "refs/heads/main", { repository: root })).rejects.toThrow(
      "must not be symbolic",
    )
    await git(["symbolic-ref", "--delete", "refs/tags/v0.3.0"], root)
    await git(["tag", "v0.3.0", head], root)
    await expect(verifyReleaseVersion("v0.3.0", head, "refs/heads/main", { repository: root })).rejects.toThrow(
      "must be an annotated tag",
    )

    await git(["tag", "-d", "v0.3.0"], root)
    await git(["commit", "--allow-empty", "-m", "later commit"], root)
    const later = await git(["rev-parse", "HEAD"], root)
    await git(["tag", "-a", "v0.3.0", "-m", "Wrong target"], root)
    await expect(verifyReleaseVersion("v0.3.0", head, "refs/heads/main", { repository: root })).rejects.toThrow(
      "direct target does not match selected main commit",
    )

    await git(["tag", "-d", "v0.3.0"], root)
    await git(["tag", "-a", "v0.3.0", head, "-m", "Right target"], root)
    await git(["update-ref", "refs/remotes/origin/main", later, head], root)
    await expect(verifyReleaseVersion("v0.3.0", head, "refs/heads/main", { repository: root })).rejects.toThrow(
      "not the current origin/main",
    )
  }, 15_000)

  test("rejects a tag object whose embedded name does not match its release ref", async () => {
    const { head, root } = await releaseRepository()
    await git(["tag", "-a", "v9.9.9", head, "-m", "Different embedded name"], root)
    const mismatchedObject = await git(["rev-parse", "refs/tags/v9.9.9"], root)
    await git(["update-ref", "refs/tags/v0.3.0", mismatchedObject], root)

    await expect(verifyReleaseVersion("v0.3.0", head, "refs/heads/main", { repository: root })).rejects.toThrow(
      "embedded tag name must exactly match",
    )
  })

  test("rejects nested annotated tags instead of accepting their peeled commit", async () => {
    const { head, root, tagObjectId } = await releaseRepository()
    await git(["tag", "-d", "v0.3.0"], root)
    await git(["tag", "-a", "v0.3.0", tagObjectId, "-m", "Nested release tag"], root)

    await expect(verifyReleaseVersion("v0.3.0", head, "refs/heads/main", { repository: root })).rejects.toThrow(
      "direct target type must be commit",
    )
  })

  test("rejects a changed tag object even when it still directly targets the same commit", async () => {
    const { head, root, tagObjectId } = await releaseRepository()
    await git(["tag", "-f", "-a", "v0.3.0", head, "-m", "Replacement tag object"], root)

    await expect(
      verifyReleaseVersion("v0.3.0", head, "refs/heads/main", { expectedTagObjectId: tagObjectId, repository: root }),
    ).rejects.toThrow("object changed")
  })
})
