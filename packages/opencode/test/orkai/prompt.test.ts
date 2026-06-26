import fs from "fs/promises"
import path from "path"
import { describe, expect, test } from "bun:test"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Effect } from "effect"
import {
  OPERATING_PROTOCOL,
  OrkaiPrompt,
  TASK_AWARENESS,
  primaryBlock,
  toolText,
  truncate,
} from "../../src/orkai/prompt"
import { tmpdir } from "../fixture/fixture"

describe("orkai prompt", () => {
  test("truncate caps long context", () => {
    const text = "x".repeat(9000)
    expect(truncate(text, 100)).toBe(`${"x".repeat(100)}\n\n[orkai context truncated]`)
  })

  test("toolText reads text parts", () => {
    expect(toolText({ content: [{ type: "text", text: "hello" }] })).toBe("hello")
    expect(toolText({ content: [{ type: "image" }] })).toBe("")
  })

  test("primaryBlock includes protocol and context", () => {
    const block = primaryBlock("session summary")
    expect(block).toContain(OPERATING_PROTOCOL)
    expect(block).toContain("## Orkai Session Context")
    expect(block).toContain("session summary")
  })

  test("operating protocol includes session start, planning, and workflow rules", () => {
    expect(OPERATING_PROTOCOL).toContain("Orkai Integration — Core Operating Protocol")
    expect(OPERATING_PROTOCOL).toContain("Session start (MANDATORY")
    expect(OPERATING_PROTOCOL).toContain("Multi-step work")
    expect(OPERATING_PROTOCOL).toContain("Workflow enforcement")
  })

  test("primaryBlock mandates overview when context is missing", () => {
    const block = primaryBlock(undefined)
    expect(block).toContain("## Orkai Session Context")
    expect(block).toContain("orkai_overview")
  })

  test("agent routing", () => {
    expect(OrkaiPrompt.primary({ name: "build" } as never)).toBe(true)
    expect(OrkaiPrompt.primary({ name: "explore" } as never)).toBe(false)
    expect(OrkaiPrompt.task({ name: "explore" } as never)).toBe(true)
    expect(OrkaiPrompt.task({ name: "title" } as never)).toBe(false)
  })

  test("active respects disable flag", () => {
    process.env.OPENCODE_DISABLE_ORKAI = "1"
    expect(OrkaiPrompt.active({})).toBe(false)
    delete process.env.OPENCODE_DISABLE_ORKAI
  })

  test("sessionStartSection omits empty bodies", () => {
    expect(OrkaiPrompt.sessionStartSection("Overview", "")).toBeUndefined()
    expect(OrkaiPrompt.sessionStartSection("Overview", "hello")).toContain("### Overview")
  })

  test("SESSION_START_REMINDER mentions overview", () => {
    expect(OrkaiPrompt.SESSION_START_REMINDER).toContain("orkai_overview")
  })

  test("SESSION_START_REMINDER mentions category_ids", () => {
    expect(OrkaiPrompt.SESSION_START_REMINDER).toContain("category_ids")
  })

  test("environment includes scoped orkai status when enabled", async () => {
    const previousHome = process.env.OPENCODE_TEST_HOME
    await using home = await tmpdir()
    await using workspace = await tmpdir({
      init: (directory) =>
        Bun.write(
          path.join(directory, ".orkai.yaml"),
          ["project:", "  name: opencode", "  category_id: test-category"].join("\n"),
        ),
    })

    try {
      process.env.OPENCODE_TEST_HOME = home.path
      await fs.mkdir(path.join(home.path, ".orkai"), { recursive: true })
      await Bun.write(path.join(home.path, ".orkai", "credentials"), "username: marco\npassword: secret\n")
      await Bun.write(path.join(home.path, ".orkai", "runtime.json"), JSON.stringify({ mcp_port: 8989 }))

      const lines = await Effect.runPromise(
        Effect.gen(function* () {
          const fsys = yield* FSUtil.Service
          return yield* OrkaiPrompt.environment({ directory: workspace.path, config: {}, fs: fsys })
        }).pipe(Effect.provide(FSUtil.defaultLayer)),
      )

      expect(lines).toContain("Orkai integration: enabled")
      expect(lines).toContain("  Orkai project: opencode")
      expect(lines).toContain("  Orkai category_id: test-category")
      expect(lines).toContain("  Orkai MCP: configured")
      expect(lines).toContain("  Orkai config: .orkai.yaml")
    } finally {
      if (previousHome === undefined) delete process.env.OPENCODE_TEST_HOME
      else process.env.OPENCODE_TEST_HOME = previousHome
    }
  })
})
