import { describe, expect, test } from "bun:test"
import {
  OPERATING_PROTOCOL,
  OrkaiPrompt,
  TASK_AWARENESS,
  primaryBlock,
  toolText,
  truncate,
} from "../../src/orkai/prompt"

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
})
