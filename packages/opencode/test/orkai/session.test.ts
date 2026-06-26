import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import {
  compactSessionName,
  compactSessionText,
  OrkaiSession,
  parseSessionEntityId,
} from "../../src/orkai/session"

describe("orkai session", () => {
  test("compactSessionName uses Auto-compact for default titles", () => {
    expect(compactSessionName("New session - 2026-06-26T12:00:00.000Z")).toMatch(/^Session: Auto-compact - /)
    expect(compactSessionName("Fix scroll bug")).toMatch(/^Session: Fix scroll bug - /)
  })

  test("compactSessionText includes summary and meta", () => {
    const text = compactSessionText({
      summary: "Implemented orkai compact save.",
      sessionID: "ses_123" as never,
      auto: true,
    })
    expect(text).toContain("## What was done")
    expect(text).toContain("Implemented orkai compact save.")
    expect(text).toContain("ses_123")
    expect(text).toContain("auto")
  })

  test("parseSessionEntityId reads JSON id", () => {
    expect(parseSessionEntityId({ content: [{ type: "text", text: '{"id":"abc-123","name":"Session"}' }] })).toBe(
      "abc-123",
    )
  })

  test("parseSessionEntityId reads id from embedded JSON text", () => {
    expect(
      parseSessionEntityId({
        content: [{ type: "text", text: 'Created session {"id":"xyz","name":"Session: test - 2026-06-26"}' }],
      }),
    ).toBe("xyz")
  })

  test("saveCompactSummary skips when orkai disabled", async () => {
    process.env.OPENCODE_DISABLE_ORKAI = "1"
    const id = await Effect.runPromise(
      OrkaiSession.saveCompactSummary({
        directory: "/tmp",
        config: {},
        fs: {} as never,
        summary: "summary",
        sessionID: "ses_1" as never,
        title: "Test",
        auto: true,
      }),
    )
    expect(id).toBeUndefined()
    delete process.env.OPENCODE_DISABLE_ORKAI
  })
})
