import { describe, expect, test } from "bun:test"
import {
  encodeToken,
  endpointFromCredentials,
  parseCredentialsYaml,
  parseRuntimeJson,
  sseURL,
} from "../../src/orkai/credentials"
import { disabled, hasServer, inject, remoteConfig, resolveEndpointSync } from "../../src/orkai/mcp"
import { parseProjectYaml } from "../../src/orkai/project-config"

describe("orkai credentials", () => {
  test("encodeToken matches orkai base64 JSON payload", () => {
    const token = encodeToken("marco", "secret")
    expect(Buffer.from(token, "base64").toString()).toBe(JSON.stringify({ username: "marco", password: "secret" }))
  })

  test("parseCredentialsYaml reads username and password", () => {
    expect(parseCredentialsYaml("username: a\npassword: b")).toEqual({ username: "a", password: "b" })
    expect(parseCredentialsYaml("username: a")).toBeUndefined()
  })

  test("endpointFromCredentials uses runtime mcp port", () => {
    const endpoint = endpointFromCredentials({ username: "a", password: "b" }, { mcp_port: 9999 })
    expect(endpoint.sseURL).toBe(sseURL(9999))
    expect(endpoint.token).toBe(encodeToken("a", "b"))
  })

  test("resolveEndpointSync builds endpoint from yaml + runtime json", () => {
    const endpoint = resolveEndpointSync({
      credentialsText: "username: a\npassword: b",
      runtimeText: JSON.stringify({ mcp_port: 8787 }),
    })
    expect(endpoint?.sseURL).toBe("http://127.0.0.1:8787/v2/sse")
  })

  test("parseRuntimeJson reads mcp_port", () => {
    expect(parseRuntimeJson(JSON.stringify({ mcp_port: 8787, pid: 1 }))).toEqual({ mcp_port: 8787, pid: 1 })
  })
})

describe("orkai mcp config", () => {
  test("remoteConfig disables oauth and sets bearer header", () => {
    const config = remoteConfig({ sseURL: "http://127.0.0.1:8787/v2/sse", token: "abc" })
    expect(config).toEqual({
      type: "remote",
      url: "http://127.0.0.1:8787/v2/sse",
      enabled: true,
      oauth: false,
      headers: { Authorization: "Bearer abc" },
    })
  })

  test("inject adds orkai server when missing", () => {
    delete process.env.OPENCODE_DISABLE_ORKAI
    const endpoint = { sseURL: "http://127.0.0.1:8787/v2/sse", token: "abc" }
    const next = inject({}, endpoint)
    expect(hasServer(next)).toBe(true)
    expect(next.mcp?.orkai).toEqual(remoteConfig(endpoint))
  })

  test("inject skips when orkai already configured", () => {
    const existing = {
      mcp: {
        orkai: remoteConfig({ sseURL: "http://custom/sse", token: "keep" }),
      },
    }
    const next = inject(existing, { sseURL: "http://127.0.0.1:8787/v2/sse", token: "new" })
    expect(next.mcp?.orkai).toEqual(existing.mcp?.orkai)
  })

  test("disabled respects OPENCODE_DISABLE_ORKAI", () => {
    process.env.OPENCODE_DISABLE_ORKAI = "1"
    expect(disabled({})).toBe(true)
    delete process.env.OPENCODE_DISABLE_ORKAI
    expect(disabled({})).toBe(false)
  })

  test("disabled respects mcp.orkai.enabled=false", () => {
    expect(disabled({ mcp: { orkai: { enabled: false } } })).toBe(true)
  })
})

describe("orkai project config", () => {
  test("parseProjectYaml reads project fields", () => {
    expect(
      parseProjectYaml(
        ["project:", "  name: opencode", "  category_id: abc123"].join("\n"),
      ),
    ).toEqual({ name: "opencode", category_id: "abc123" })
  })
})
