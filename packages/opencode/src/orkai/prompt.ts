import path from "path"
import type { Agent } from "@/agent/agent"
import type { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import type { FSUtil } from "@opencode-ai/core/fs-util"
import { Effect } from "effect"
import { callTool, disabled, paths, resolveEndpointFromFiles } from "./mcp"
import { parseProjectYaml } from "./project-config"

const PROJECT_FILE = ".orkai.yaml"
const MAX_CONTEXT_CHARS = 8000

export const OPERATING_PROTOCOL = `# Orkai Integration — Core Operating Protocol

You have persistent memory via orkai (MCP server \`orkai\`). Use it proactively — do not wait for the user to ask.

## Session continuity
- At conversation start: review the **Orkai Session Context** block below (prefetched from \`orkai_overview\`).
- For deeper history: \`orkai_session\` with action \`latest\` or \`get\` on a session ID from the overview.
- User Preferences and Agent Preferences in the context block are **mandatory** — follow verbatim.

## During work
- **Search before reading files**: prefer \`orkai_search_code\` for semantic code discovery; fall back to Grep/Read when needed.
- **Check standards/skills** before architecture or pattern decisions: \`orkai_standards\`, \`orkai_skills\`.
- **Multi-step work**: persist plan → milestone → tasks via \`orkai_plan\`, \`orkai_milestone\`, \`orkai_tasks\` before large implementations.
- **Workflows**: \`orkai_workflow\` search/get for repeatable practices matching the task.

## Session end
- When the user signals wrap-up, offer to save a session summary via \`orkai_session\` create.
- Suggest \`orkai index\` if source files changed materially.

## Auto-compact awareness
When context is auto-compacted, a summary may be saved to orkai automatically — treat saved session summaries as continuity anchors.`

export const TASK_AWARENESS = `# Orkai awareness

Orkai MCP tools (\`orkai_search_code\`, \`orkai_search_document\`, etc.) provide semantic search over indexed code and docs. Prefer \`orkai_search_code\` over Grep when exploring by meaning. Planning tools (\`orkai_plan\`, \`orkai_tasks\`) exist for multi-step work tracked by the primary agent.`

const PRIMARY = new Set(["build", "plan"])
const TASK = new Set(["general", "explore"])

type Info = ConfigV1.Info

export function active(config: Info) {
  return !disabled(config)
}

export function primary(agent: Agent.Info) {
  return PRIMARY.has(agent.name)
}

export function task(agent: Agent.Info) {
  return TASK.has(agent.name)
}

export function truncate(text: string, max = MAX_CONTEXT_CHARS) {
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n\n[orkai context truncated]`
}

export function toolText(result: { content?: ReadonlyArray<{ type: string; text?: string }> }) {
  return result.content?.find((part) => part.type === "text")?.text ?? ""
}

export function primaryBlock(context?: string) {
  if (!context) return OPERATING_PROTOCOL
  return [OPERATING_PROTOCOL, "", "## Orkai Session Context", "", context].join("\n")
}

export const environment = Effect.fn("OrkaiPrompt.environment")(function* (input: {
  directory: string
  config: Info
  fs: FSUtil.Interface
}) {
  if (!active(input.config)) return []

  const hits = yield* input.fs.findUp(PROJECT_FILE, input.directory).pipe(
    Effect.catch(() => Effect.succeed([] as string[])),
  )
  const projectFile = hits[0]
  const projectText = projectFile
    ? yield* input.fs.readFileStringSafe(projectFile).pipe(Effect.catch(() => Effect.succeed(undefined)))
    : undefined
  const project = projectText ? parseProjectYaml(projectText) : undefined
  const credentials = yield* input.fs
    .readFileStringSafe(paths.credentials())
    .pipe(Effect.catch(() => Effect.succeed(undefined)))
  const runtime = yield* input.fs.readFileStringSafe(paths.runtime()).pipe(Effect.catch(() => Effect.succeed(undefined)))
  const endpoint = credentials ? resolveEndpointFromFiles({ credentials, runtime }) : undefined

  return [
    "Orkai integration: enabled",
    `  Orkai project: ${project?.name ?? "unknown"}`,
    ...(project?.category_id ? [`  Orkai category_id: ${project.category_id}`] : []),
    `  Orkai MCP: ${endpoint ? "configured" : "missing credentials"}`,
    ...(projectFile ? [`  Orkai config: ${path.relative(input.directory, projectFile) || PROJECT_FILE}`] : []),
  ]
})

export const prefetch = Effect.fn("OrkaiPrompt.prefetch")(function* (input: {
  directory: string
  config: Info
  fs: FSUtil.Interface
}) {
  if (!active(input.config)) return undefined

  const credentials = yield* input.fs
    .readFileStringSafe(paths.credentials())
    .pipe(Effect.catch(() => Effect.succeed(undefined)))
  if (!credentials) return undefined

  const runtime = yield* input.fs
    .readFileStringSafe(paths.runtime())
    .pipe(Effect.catch(() => Effect.succeed(undefined)))
  const endpoint = resolveEndpointFromFiles({ credentials, runtime })
  if (!endpoint) return undefined

  const hits = yield* input.fs.findUp(PROJECT_FILE, input.directory).pipe(
    Effect.catch(() => Effect.succeed([] as string[])),
  )
  const projectText = hits[0]
    ? yield* input.fs.readFileStringSafe(hits[0]).pipe(Effect.catch(() => Effect.succeed(undefined)))
    : undefined
  const project = projectText ? parseProjectYaml(projectText) : undefined

  const result = yield* callTool(
    "overview",
    {
      ...(project?.name ? { project_name: project.name } : {}),
      ...(project?.category_id ? { category_id: project.category_id } : {}),
    },
    endpoint,
  )

  const text = toolText(result).trim()
  if (!text) return undefined
  return truncate(text)
})

export * as OrkaiPrompt from "./prompt"
