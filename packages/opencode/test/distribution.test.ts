import { describe, expect, test } from "bun:test"
import { Distribution } from "../src/distribution"

describe("distribution", () => {
  test("points update checks at the fork GitHub repo", () => {
    expect(Distribution.GITHUB_REPO).toBe("elfullstack/orkaicode")
    expect(Distribution.latestReleaseApiUrl).toContain("elfullstack/orkaicode")
    expect(Distribution.latestReleaseApiUrl).not.toContain("anomalyco/opencode")
  })

  test("autoupdate is opt-in only", () => {
    expect(Distribution.autoupdateAllowed({})).toBe(false)
    expect(Distribution.autoupdateAllowed({ autoupdate: false })).toBe(false)
    expect(Distribution.autoupdateAllowed({ autoupdate: true })).toBe(true)
    expect(Distribution.autoupdateAllowed({ autoupdate: "notify" })).toBe(true)
  })

  test("upgrade message references fork releases", () => {
    expect(Distribution.upgradeMessage()).toContain("elfullstack/orkaicode")
    expect(Distribution.upgradeMessage()).toContain("/releases")
  })
})
