import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import { ConfigMCPV1 } from "@opencode-ai/core/v1/config/mcp"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { Flag } from "@opencode-ai/core/flag/flag"
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js"
import { Effect } from "effect"
import { CallFailedError } from "./error"
import {
  credentialsPath,
  endpointFromCredentials,
  parseCredentialsYaml,
  parseRuntimeJson,
  runtimePath,
  type Endpoint,
} from "./credentials"

export const SERVER_NAME = "orkai"

const DEFAULT_TIMEOUT = 30_000

type Info = ConfigV1.Info

function isConfigured(entry: NonNullable<Info["mcp"]>[string]) {
  return typeof entry === "object" && entry !== null && "type" in entry
}

export function disabled(config: Info) {
  if (Flag.OPENCODE_DISABLE_ORKAI) return true
  const entry = config.mcp?.[SERVER_NAME]
  if (!entry || typeof entry !== "object") return false
  if ("enabled" in entry && entry.enabled === false) return true
  return false
}

export function hasServer(config: Info) {
  const entry = config.mcp?.[SERVER_NAME]
  return !!entry && isConfigured(entry)
}

export function remoteConfig(endpoint: Endpoint): ConfigMCPV1.Remote {
  return {
    type: "remote",
    url: endpoint.sseURL,
    enabled: true,
    oauth: false,
    headers: {
      Authorization: `Bearer ${endpoint.token}`,
    },
  }
}

export function inject(config: Info, endpoint: Endpoint): Info {
  if (disabled(config) || hasServer(config)) return config
  return {
    ...config,
    mcp: {
      ...config.mcp,
      [SERVER_NAME]: remoteConfig(endpoint),
    },
  }
}

export function resolveEndpointSync(input: { credentialsText: string; runtimeText?: string }) {
  const credentials = parseCredentialsYaml(input.credentialsText)
  if (!credentials) return undefined
  const runtime = input.runtimeText ? parseRuntimeJson(input.runtimeText) : undefined
  return endpointFromCredentials(credentials, runtime)
}

export function resolveEndpointFromFiles(input: { credentials?: string; runtime?: string }) {
  if (!input.credentials) return undefined
  return resolveEndpointSync({ credentialsText: input.credentials, runtimeText: input.runtime })
}

export const callTool = Effect.fn("Orkai.callTool")(function* (
  tool: string,
  args: Record<string, unknown>,
  endpoint: Endpoint,
) {
  const client = new Client({ name: "opencode", version: InstallationVersion }, { capabilities: {} })
  const transport = new SSEClientTransport(new URL(endpoint.sseURL), {
    requestInit: { headers: { Authorization: `Bearer ${endpoint.token}` } },
  })

  return yield* Effect.tryPromise({
    try: async () => {
      await client.connect(transport)
      try {
        return await client.callTool(
          { name: tool, arguments: args },
          CallToolResultSchema,
          {
            resetTimeoutOnProgress: true,
            timeout: DEFAULT_TIMEOUT,
            onprogress: () => {},
          },
        )
      } finally {
        await client.close()
      }
    },
    catch: (cause) =>
      new CallFailedError({
        tool,
        detail: cause instanceof Error ? cause.message : String(cause),
      }),
  })
})

export const paths = {
  credentials: credentialsPath,
  runtime: runtimePath,
}

export * as OrkaiMcp from "./mcp"
