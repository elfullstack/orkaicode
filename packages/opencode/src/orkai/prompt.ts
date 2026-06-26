import path from "path"
import type { Agent } from "@/agent/agent"
import type { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import type { FSUtil } from "@opencode-ai/core/fs-util"
import { Effect } from "effect"
import type { Endpoint } from "./credentials"
import { callTool, disabled, paths, resolveEndpointFromFiles } from "./mcp"
import { parseProjectYaml } from "./project-config"
import * as OrkaiProjectScope from "./project-scope"
import { errorMessage } from "@/util/error"

const PROJECT_FILE = OrkaiProjectScope.PROJECT_FILE
const MAX_CONTEXT_CHARS = 8000

export const OPERATING_PROTOCOL = `# Orkai Integration — Core Operating Protocol

You have persistent memory via orkai (MCP server \`orkai\`). Use it proactively — do not wait for the user to ask.

## Session start (MANDATORY — before your first reply)
- The server runs the **Orkai Session Start** ritual scoped to this project's \`.orkai.yaml\` (\`category_id\` + \`project.name\`) and injects results into **Orkai Session Context** below.
- Global standards/skills from other projects are excluded — use \`orkai_search_code\`, \`orkai_standards\`, and \`orkai_skills\` with this project's \`category_id\` when you need them.
- If that block is missing or says prefetch failed: call \`orkai_overview\` (with this project's \`project_name\` and \`category_id\`), \`orkai_user_preferences\` get, \`orkai_agent_preferences\` get, and \`orkai_session\` latest (with \`category_ids\`) before any other tool or reply.
- Read user and agent preferences from the context — both are **mandatory**.
- Briefly acknowledge what prior context matters for this session (workflow step 5).

## Session continuity
- For deeper history: \`orkai_session\` with action \`latest\` (scoped via \`category_ids\` from \`.orkai.yaml\`) or \`get\` on a session ID from the overview.

## During work
- **Search before reading files**: prefer \`orkai_search_code\` for semantic code discovery; fall back to Grep/Read when needed.
- **Check standards/skills** before architecture or pattern decisions: \`orkai_standards\`, \`orkai_skills\` — always pass this project's \`category_ids\`.
- **Multi-step work**: persist plan → milestone → tasks via \`orkai_plan\`, \`orkai_milestone\`, \`orkai_tasks\` before large implementations.
- **Workflows**: \`orkai_workflow\` search/get for repeatable practices matching the task.

## Workflow enforcement (NON-NEGOTIABLE)
- Before non-trivial work, search \`orkai_workflow\` for a matching practice (built-ins: **Orkai Session Start**, **Orkai Planning**, **Orkai Session Save**).
- If a match exists, follow its steps — do not improvise a different process.
- If no match, propose creating a workflow via \`orkai_workflow\` create before proceeding.
- Deviation requires explicit user approval.

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
  if (!context?.trim()) {
    return [
      OPERATING_PROTOCOL,
      "",
      "## Orkai Session Context",
      "",
      "_Overview prefetch failed or is empty. Before your first reply, run the Orkai Session Start ritual scoped to .orkai.yaml: orkai_overview (project_name + category_id), orkai_user_preferences get, orkai_agent_preferences get, orkai_session latest (category_ids)._",
    ].join("\n")
  }
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

export const SESSION_START_REMINDER = `Orkai session start: the server injected project-scoped context into your system prompt (**Orkai Session Context**). Before your first reply:
1. Read that section — it is scoped to this project's .orkai.yaml (category_id + project.name).
2. If it is missing or says prefetch failed: call orkai_overview (project_name + category_id), orkai_user_preferences get, orkai_agent_preferences get, and orkai_session latest (category_ids) — do not reply until those complete.
3. Briefly tell the user what prior context matters for this session.`

export function sessionStartSection(title: string, text: string, max = MAX_CONTEXT_CHARS) {
  const body = text.trim()
  if (!body) return undefined
  return `### ${title}\n\n${truncate(body, max)}`
}

function listItemNames(result: { content?: ReadonlyArray<{ type: string; text?: string }> }) {
  return OrkaiProjectScope.listItemNames(result)
}

function scopedNameList(title: string, names: string[]) {
  if (names.length === 0) return undefined
  return sessionStartSection(title, names.map((name) => `- ${name}`).join("\n"))
}

function callToolSafe(tool: string, args: Record<string, unknown>, endpoint: Endpoint) {
  return callTool(tool, args, endpoint).pipe(
    Effect.catch((cause) =>
      Effect.gen(function* () {
        yield* Effect.logWarning(`orkai ${tool} failed during session start`, { error: errorMessage(cause) })
        return { content: [] }
      }),
    ),
  )
}

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

  const resolved = yield* OrkaiProjectScope.resolve({ directory: input.directory, fs: input.fs })
  if (!resolved?.scope) {
    yield* Effect.logWarning("orkai session start skipped: project scope unresolved", {
      hint: resolved?.hint ?? `missing ${PROJECT_FILE}`,
    })
    return undefined
  }

  const scope = resolved.scope
  const sections: string[] = []

  const scopeHeader = sessionStartSection(
    "Project scope",
    [
      `project.name: ${scope.projectName}`,
      `category_id: ${scope.categoryID}`,
      `config: ${path.relative(input.directory, scope.projectFile) || PROJECT_FILE}`,
    ].join("\n"),
  )
  if (scopeHeader) sections.push(scopeHeader)

  const overview = yield* callToolSafe("overview", OrkaiProjectScope.overviewArgs(scope), endpoint)
  const scopedOverview = OrkaiProjectScope.scopedOverviewSections(toolText(overview))
  const overviewSection = sessionStartSection("Overview", scopedOverview)
  if (overviewSection) sections.push(overviewSection)

  const userPrefs = yield* callToolSafe("user_preferences", { action: "get" }, endpoint)
  const userSection = sessionStartSection("User preferences", toolText(userPrefs))
  if (userSection) sections.push(userSection)

  const agentPrefs = yield* callToolSafe("agent_preferences", { action: "get" }, endpoint)
  const agentSection = sessionStartSection("Agent preferences", toolText(agentPrefs))
  if (agentSection) sections.push(agentSection)

  const latest = yield* callToolSafe("session", OrkaiProjectScope.sessionLatestArgs(scope), endpoint)
  const latestSection = sessionStartSection("Latest session", toolText(latest))
  if (latestSection) sections.push(latestSection)

  const standards = scopedNameList(
    "Project standards",
    listItemNames(yield* callToolSafe("standards", OrkaiProjectScope.categoryListArgs(scope), endpoint)),
  )
  if (standards) sections.push(standards)

  const skills = scopedNameList(
    "Project skills",
    listItemNames(yield* callToolSafe("skills", OrkaiProjectScope.categoryListArgs(scope), endpoint)),
  )
  if (skills) sections.push(skills)

  const workflows = scopedNameList(
    "Project workflows",
    listItemNames(yield* callToolSafe("workflow", OrkaiProjectScope.categoryListArgs(scope), endpoint)),
  )
  if (workflows) sections.push(workflows)

  if (sections.length === 0) return undefined

  yield* Effect.logInfo("orkai session start ritual complete", {
    category_id: scope.categoryID,
    project_name: scope.projectName,
    sections: sections.map((section) => section.split("\n")[0]),
  })

  return truncate(sections.join("\n\n---\n\n"))
})

export * as OrkaiPrompt from "./prompt"
