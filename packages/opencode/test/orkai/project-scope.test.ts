import { describe, expect, test } from "bun:test"
import { scopedOverviewSections, requireScope } from "../../src/orkai/project-scope"

describe("orkai project scope", () => {
  test("requireScope needs category_id and project.name", () => {
    expect(requireScope({ project: { name: "opencode" }, projectFile: ".orkai.yaml", directory: "/repo" }).ok).toBe(
      false,
    )
    expect(
      requireScope({
        project: { name: "opencode", category_id: "abc" },
        projectFile: ".orkai.yaml",
        directory: "/repo",
      }).ok,
    ).toBe(true)
  })

  test("scopedOverviewSections drops global standards and skills", () => {
    const raw = [
      "# orkai v2 — Your Persistent Memory",
      "",
      "**Total**: 99999 entities",
      "",
      "## Recent Sessions",
      "",
      "Sessions for **opencode**:",
      "",
      "1. **Session: test**",
      "",
      "## Standards (10)",
      "",
      "- Cover Letter Writing Principles",
      "",
      "## User Preferences (CRITICAL — follow verbatim)",
      "",
      "follow tests",
      "",
      "## Skills (289)",
      "",
      "- Cloud Engineer AWS",
    ].join("\n")

    const scoped = scopedOverviewSections(raw)
    expect(scoped).toContain("Recent Sessions")
    expect(scoped).toContain("User Preferences")
    expect(scoped).not.toContain("Standards")
    expect(scoped).not.toContain("Cloud Engineer")
    expect(scoped).not.toContain("99999")
  })
})
