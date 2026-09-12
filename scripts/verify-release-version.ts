import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

const strictSemVer =
  /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

export interface ReleaseProvenance {
  tag: string
  tagObjectId: string
  commitSha: string
  version: string
}

export interface ReleaseVerificationOptions {
  expectedTagObjectId?: string
  repository?: string
}

export async function verifyReleaseVersion(
  tag: string | undefined,
  expectedSha: string | undefined,
  workflowRef: string | undefined,
  options: ReleaseVerificationOptions = {},
): Promise<ReleaseProvenance> {
  if (!tag) throw new Error("Expected a release tag argument such as v1.2.3.")
  if (!strictSemVer.test(tag)) {
    throw new Error(`Release tag ${tag} is not strict Semantic Version syntax.`)
  }
  if (!/^[a-f0-9]{40}$/.test(expectedSha ?? "")) throw new Error("Expected the selected full GitHub commit SHA.")
  if (options.expectedTagObjectId !== undefined && !/^[a-f0-9]{40}$/.test(options.expectedTagObjectId)) {
    throw new Error("Expected the previously validated full tag object ID.")
  }
  if (workflowRef !== "refs/heads/main") throw new Error("Releases may run only from refs/heads/main.")

  const repository = options.repository ?? resolve(import.meta.dir, "..")
  const packageJson = JSON.parse(await readFile(resolve(repository, "package.json"), "utf8")) as { name?: string; version?: string; publishConfig?: { registry?: string; access?: string } }
  if (packageJson.name !== "@openaxes/pi-subagents" || packageJson.publishConfig?.registry !== "https://npm.pkg.github.com" || packageJson.publishConfig?.access !== "restricted") {
    throw new Error("Release requires the exact private OpenAxes package identity and registry.")
  }
  if (!packageJson.version) throw new Error("package.json is missing a version.")
  if (tag !== `v${packageJson.version}`) throw new Error(`Release tag ${tag} does not match package version v${packageJson.version}.`)

  const git = async (args: string[]) => (
    await execFileAsync("git", args, {
      cwd: repository,
      encoding: "utf8",
      env: { ...process.env, GIT_NO_REPLACE_OBJECTS: "1" },
      windowsHide: true,
    })
  ).stdout.trim()
  if (await git(["for-each-ref", "--format=%(symref)", `refs/tags/${tag}`])) throw new Error(`Release tag ${tag} must not be symbolic.`)
  const tagObjectId = await git(["rev-parse", "--verify", `refs/tags/${tag}`])
  if (!/^[a-f0-9]{40}$/.test(tagObjectId)) throw new Error(`Release tag ${tag} did not resolve to a full tag object ID.`)
  if (options.expectedTagObjectId !== undefined && tagObjectId !== options.expectedTagObjectId) {
    throw new Error(`Release tag ${tag} object changed from ${options.expectedTagObjectId} to ${tagObjectId}.`)
  }
  if (await git(["cat-file", "-t", tagObjectId]) !== "tag") throw new Error(`Release tag ${tag} must be an annotated tag.`)

  const tagHeaders = (await git(["cat-file", "-p", tagObjectId])).split(/\r?\n\r?\n/, 1)[0]?.split(/\r?\n/) ?? []
  const objectHeaders = tagHeaders.filter((line) => line.startsWith("object "))
  const typeHeaders = tagHeaders.filter((line) => line.startsWith("type "))
  const nameHeaders = tagHeaders.filter((line) => line.startsWith("tag "))
  if (objectHeaders.length !== 1 || !/^object [a-f0-9]{40}$/.test(objectHeaders[0] ?? "")) {
    throw new Error(`Release tag ${tag} must contain one full direct target object ID.`)
  }
  if (typeHeaders.length !== 1 || typeHeaders[0] !== "type commit") {
    throw new Error(`Release tag ${tag} direct target type must be commit.`)
  }
  if (nameHeaders.length !== 1 || nameHeaders[0] !== `tag ${tag}`) {
    throw new Error(`Release tag ${tag} embedded tag name must exactly match the ref name.`)
  }

  const directTargetSha = objectHeaders[0]!.slice("object ".length)
  if (await git(["cat-file", "-t", directTargetSha]) !== "commit") {
    throw new Error(`Release tag ${tag} direct target object must exist as a commit.`)
  }
  if (directTargetSha !== expectedSha) throw new Error(`Release tag ${tag} direct target does not match selected main commit ${expectedSha}.`)
  const peeledSha = await git(["rev-parse", `refs/tags/${tag}^{}`])
  if (peeledSha !== directTargetSha) throw new Error(`Release tag ${tag} peeled commit does not match its direct target ${directTargetSha}.`)
  const mainCommit = await git(["rev-parse", "refs/remotes/origin/main"])
  if (mainCommit !== expectedSha) throw new Error(`Selected release commit ${expectedSha} is not the current origin/main commit.`)
  return { tag, tagObjectId, commitSha: directTargetSha, version: packageJson.version }
}

export async function releaseVersionCli(args: string[], options: Pick<ReleaseVerificationOptions, "repository"> = {}): Promise<string> {
  const expectedTagObjectId = args[3]
  const provenance = await verifyReleaseVersion(
    args[0],
    args[1],
    args[2],
    expectedTagObjectId === undefined ? options : { ...options, expectedTagObjectId },
  )
  return `${JSON.stringify(provenance)}\n`
}

if (import.meta.main) process.stdout.write(await releaseVersionCli(process.argv.slice(2)))
