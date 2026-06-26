import { afterEach, describe, expect, mock, test } from "bun:test"
import { Effect } from "effect"

let toolCalls: Array<{ tool: string; args: Record<string, unknown>; endpoint: unknown }> = []
let toolFailure: Error | undefined

void mock.module("../../src/orkai/mcp", () => ({
  callTool: (tool: string, args: Record<string, unknown>, endpoint: unknown) => {
    toolCalls.push({ tool, args, endpoint })
    if (toolFailure) return Effect.fail(toolFailure)
    return Effect.succeed({ content: [{ type: "text", text: '{"id":"orkai-session-1"}' }] })
  },
  paths: {
    credentials: () => "/tmp/orkai/credentials.yaml",
    runtime: () => "/tmp/orkai/runtime.json",
  },
  resolveEndpointFromFiles: (input: { credentials?: string; runtime?: string }) =>
    input.credentials ? { sseURL: "http://127.0.0.1:4317/sse", token: "test-token" } : undefined,
}))

const { OrkaiSession } = await import("../../src/orkai/session")

afterEach(() => {
  toolCalls = []
  toolFailure = undefined
  delete process.env.OPENCODE_DISABLE_ORKAI
})

function fs(projectText?: string) {
  return {
    findUp: () => Effect.succeed(projectText === undefined ? [] : ["/workspace/.orkai.yaml"]),
    readFileStringSafe: (file: string) => {
      if (file === "/tmp/orkai/credentials.yaml") return Effect.succeed("token: test-token")
      if (file === "/tmp/orkai/runtime.json") return Effect.succeed('{"port":4317}')
      if (file === "/workspace/.orkai.yaml" && projectText !== undefined) return Effect.succeed(projectText)
      return Effect.fail(new Error(`unexpected file read: ${file}`))
    },
  }
}

describe("orkai compact session save", () => {
  test("creates an orkai session in the project category", async () => {
    const id = await Effect.runPromise(
      OrkaiSession.saveCompactSummary({
        directory: "/workspace",
        config: {},
        fs: fs("project:\n  name: opencode\n  category_id: cat_123\n") as never,
        summary: "Important session summary.",
        sessionID: "ses_123" as never,
        title: "Feature work",
        auto: false,
      }),
    )

    expect(id).toBe("orkai-session-1")
    expect(toolCalls).toHaveLength(1)
    expect(toolCalls[0]?.tool).toBe("session")
    expect(toolCalls[0]?.args).toMatchObject({
      action: "create",
      name: expect.stringMatching(/^Session: Feature work - /),
      description: "Manual compact session save",
      category_ids: ["cat_123"],
    })
    expect(String(toolCalls[0]?.args.text)).toContain("Important session summary.")
    expect(String(toolCalls[0]?.args.text)).toContain("- opencode session: ses_123")
    expect(String(toolCalls[0]?.args.text)).toContain("- compaction: manual")
  })

  test("skips save when project category is missing", async () => {
    const id = await Effect.runPromise(
      OrkaiSession.saveCompactSummary({
        directory: "/workspace",
        config: {},
        fs: fs("project:\n  name: opencode\n") as never,
        summary: "Summary",
        sessionID: "ses_123" as never,
        title: "Feature work",
        auto: true,
      }),
    )

    expect(id).toBeUndefined()
    expect(toolCalls).toHaveLength(0)
  })

  test("returns undefined when orkai save fails", async () => {
    toolFailure = new Error("daemon unavailable")

    const id = await Effect.runPromise(
      OrkaiSession.saveCompactSummary({
        directory: "/workspace",
        config: {},
        fs: fs("project:\n  name: opencode\n  category_id: cat_123\n") as never,
        summary: "Summary",
        sessionID: "ses_123" as never,
        title: "Feature work",
        auto: true,
      }),
    )

    expect(id).toBeUndefined()
    expect(toolCalls).toHaveLength(1)
  })
})
