import { expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

const root = resolve(import.meta.dir, "../..")
test("private manual main publication has a serial, least-privilege artifact boundary", async () => {
  const workflow = await readFile(resolve(root, ".github/workflows/release.yml"), "utf8")
  expect(workflow).toContain("group: private-package-release")
  expect(workflow).toContain("if: github.ref == 'refs/heads/main'")
  expect(workflow).toContain("workflow_dispatch:")
  expect(workflow).not.toMatch(/RELEASE_PREFLIGHT_TOKEN|environment:|id-token:|registry\.npmjs\.org/)
  expect(workflow.match(/packages: write/g)).toHaveLength(1)
  expect(workflow).toContain("verify-package.mjs")
  expect(workflow).toContain("--access restricted --registry https://npm.pkg.github.com")
  expect(workflow).toContain("secrets.GITHUB_TOKEN")
  expect(workflow).not.toMatch(/^  (?:push|pull_request|release):/m)
  expect(workflow.slice(0, workflow.indexOf("\n  publish:"))).not.toMatch(/packages: write|NODE_AUTH_TOKEN:/)
  expect(workflow).toContain("needs: validate")
  expect(workflow).toContain("EXPECTED_TAG_OBJECT_ID")
  expect(workflow).toContain("Downloaded package digest does not match validation")
  expect(workflow).toContain("npm-package-${{ steps.package.outputs.package_sha256 }}")
  expect(workflow).toContain("result?.error?.code !== \"E404\"")
  for (const match of workflow.matchAll(/uses: (\S+)/g)) expect(match[1]).toMatch(/^(?:actions|oven-sh)\/[a-z-]+@[a-f0-9]{40}$/)
  expect(workflow).toContain("--tag openaxes")
})

