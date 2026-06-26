import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { BUILTIN, existsByName, OrkaiWorkflows, searchNames } from "../../src/orkai/workflows"

describe("orkai workflows", () => {
  test("BUILTIN defines three workflows", () => {
    expect(BUILTIN.length).toBe(3)
    expect(BUILTIN.map((w) => w.name)).toEqual([
      "Orkai Session Start",
      "Orkai Planning",
      "Orkai Session Save",
    ])
  })

  test("session start graph has five nodes", () => {
    expect(BUILTIN[0].graph.nodes.length).toBe(5)
    expect(BUILTIN[0].graph.edges.length).toBe(4)
  })

  test("planning graph has seven nodes with conditional", () => {
    const planning = BUILTIN[1]
    expect(planning.graph.nodes.length).toBe(7)
    expect(planning.graph.nodes[0].type).toBe("node-conditional")
    expect(planning.graph.edges.some((edge) => edge.type === "edge-true")).toBe(true)
    expect(planning.graph.edges.some((edge) => edge.type === "edge-false")).toBe(true)
  })

  test("session save graph has three nodes", () => {
    expect(BUILTIN[2].graph.nodes.length).toBe(3)
    expect(BUILTIN[2].graph.edges.length).toBe(2)
  })

  test("searchNames parses workflow search items", () => {
    const names = searchNames({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            items: [{ name: "Orkai Planning" }, { name: "Other" }],
          }),
        },
      ],
    })
    expect(names).toEqual(["Orkai Planning", "Other"])
    expect(existsByName(names, "Orkai Planning")).toBe(true)
    expect(existsByName(names, "Missing")).toBe(false)
  })

  test("seed skips when orkai disabled", async () => {
    process.env.OPENCODE_DISABLE_ORKAI = "1"
    await Effect.runPromise(
      OrkaiWorkflows.seed({
        directory: "/tmp",
        config: {},
        fs: {} as never,
        endpoint: { sseURL: "http://127.0.0.1:8787/v2/sse", token: "t" },
      }),
    )
    delete process.env.OPENCODE_DISABLE_ORKAI
  })
})
