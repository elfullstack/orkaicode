import path from "path"
import { Global } from "@opencode-ai/core/global"
import { isRecord } from "@/util/record"

export interface Credentials {
  username: string
  password: string
}

export interface Endpoint {
  sseURL: string
  token: string
}

export interface RuntimeState {
  mcp_port?: number
  pid?: number
}

export function homeDir() {
  return Global.Path.home
}

export function credentialsPath() {
  return path.join(homeDir(), ".orkai", "credentials")
}

export function runtimePath() {
  return path.join(homeDir(), ".orkai", "runtime.json")
}

export function encodeToken(username: string, password: string) {
  return Buffer.from(JSON.stringify({ username, password })).toString("base64")
}

export function parseCredentialsYaml(text: string): Credentials | undefined {
  const parsed = Bun.YAML.parse(text)
  if (!isRecord(parsed)) return undefined
  if (typeof parsed.username !== "string" || typeof parsed.password !== "string") return undefined
  if (!parsed.username || !parsed.password) return undefined
  return { username: parsed.username, password: parsed.password }
}

export function parseRuntimeJson(text: string): RuntimeState | undefined {
  const parsed = JSON.parse(text) as unknown
  if (!isRecord(parsed)) return undefined
  return {
    mcp_port: typeof parsed.mcp_port === "number" ? parsed.mcp_port : undefined,
    pid: typeof parsed.pid === "number" ? parsed.pid : undefined,
  }
}

export function sseURL(port: number) {
  return `http://127.0.0.1:${port}/v2/sse`
}

export function endpointFromCredentials(credentials: Credentials, runtime?: RuntimeState): Endpoint {
  const port = runtime?.mcp_port && runtime.mcp_port > 0 ? runtime.mcp_port : 8787
  return {
    sseURL: sseURL(port),
    token: encodeToken(credentials.username, credentials.password),
  }
}

export * as OrkaiCredentials from "./credentials"
