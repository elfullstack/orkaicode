import path from "path"
import type { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import type { FSUtil } from "@opencode-ai/core/fs-util"
import { Effect } from "effect"
import type { Endpoint } from "./credentials"
import { callTool, paths } from "./mcp"
import { active, toolText } from "./prompt"
import { parseProjectYaml } from "./project-config"

const PROJECT_FILE = ".orkai.yaml"

type WorkflowGraph = {
  nodes: Array<{
    id: string
    type: string
    position: { x: number; y: number }
    data: Record<string, string>
    branches?: { true: string; false: string }
  }>
  edges: Array<{ id: string; source: string; target: string; type: string }>
}

type BuiltinWorkflow = {
  name: string
  description: string
  text: string
  graph: WorkflowGraph
}

const SESSION_START: BuiltinWorkflow = {
  name: "Orkai Session Start",
  description:
    "Session-start ritual: overview, preferences, latest session, then acknowledge continuity to the user.",
  text: "## Steps\n\n1. **Overview** — `orkai_overview(category_id, project_name)` from `.orkai.yaml`.\n2. **User preferences** — `orkai_user_preferences(action: \"get\")` — follow verbatim.\n3. **Agent preferences** — `orkai_agent_preferences(action: \"get\")` — follow verbatim.\n4. **Latest session** — `orkai_session(action: \"latest\")` for recent continuity.\n5. **Acknowledge** — Briefly tell the user what prior context matters for this session.",
  graph: {
    nodes: [
      {
        id: "overview",
        type: "node-code",
        position: { x: 0, y: 0 },
        data: {
          label: "Overview",
          language: "text",
          code: "orkai_overview(category_id, project_name) using values from .orkai.yaml",
        },
      },
      {
        id: "user-prefs",
        type: "node-code",
        position: { x: 350, y: 0 },
        data: {
          label: "User preferences",
          language: "text",
          code: "orkai_user_preferences(action: \"get\") — mandatory; follow verbatim",
        },
      },
      {
        id: "agent-prefs",
        type: "node-code",
        position: { x: 700, y: 0 },
        data: {
          label: "Agent preferences",
          language: "text",
          code: "orkai_agent_preferences(action: \"get\") — mandatory; follow verbatim",
        },
      },
      {
        id: "latest-session",
        type: "node-code",
        position: { x: 1050, y: 0 },
        data: {
          label: "Latest session",
          language: "text",
          code: "orkai_session(action: \"latest\") — read recent continuity",
        },
      },
      {
        id: "acknowledge",
        type: "node-text",
        position: { x: 1400, y: 0 },
        data: {
          label: "Acknowledge context",
          content:
            "Summarize for the user what prior sessions, preferences, and standards matter before proceeding.",
        },
      },
    ],
    edges: [
      { id: "e-0", source: "overview", target: "user-prefs", type: "edge-default" },
      { id: "e-1", source: "user-prefs", target: "agent-prefs", type: "edge-default" },
      { id: "e-2", source: "agent-prefs", target: "latest-session", type: "edge-default" },
      { id: "e-3", source: "latest-session", target: "acknowledge", type: "edge-default" },
    ],
  },
}

const PLANNING: BuiltinWorkflow = {
  name: "Orkai Planning",
  description:
    "Multi-step work: classify task, persist plan → milestones → tasks, implement with status updates, mark milestones done.",
  text: "## Steps\n\n1. **Classify** — Is this feature, bug, or refactor work requiring a tracked plan?\n2. **Plan** — `orkai_plan(action: \"create\")` with design in text.\n3. **Milestones** — `orkai_milestone(action: \"create\", plan_id: ...)` per milestone.\n4. **Tasks** — `orkai_tasks(action: \"create\", milestone_id: ..., status: \"pending\")` per unit of work.\n5. **Implement** — Execute tasks; update `orkai_tasks` status as you go.\n6. **Update status** — Keep task status current (`in_progress`, `done`, `blocked`).\n7. **Complete** — `orkai_milestone(action: \"update\", status: \"done\")` when a milestone finishes.",
  graph: {
    nodes: [
      {
        id: "classify",
        type: "node-conditional",
        position: { x: 0, y: 0 },
        data: {
          label: "Classify task",
          content: "Is this multi-step feature, bug, or refactor work that needs a tracked plan?",
        },
        branches: { true: "plan", false: "implement" },
      },
      {
        id: "plan",
        type: "node-code",
        position: { x: 350, y: 0 },
        data: {
          label: "Create plan",
          language: "text",
          code: "orkai_plan(action: \"create\", category_ids: [...], text: design)",
        },
      },
      {
        id: "milestones",
        type: "node-code",
        position: { x: 700, y: 0 },
        data: {
          label: "Create milestones",
          language: "text",
          code: "orkai_milestone(action: \"create\", plan_id: <plan-id>) for each milestone",
        },
      },
      {
        id: "tasks",
        type: "node-code",
        position: { x: 1050, y: 0 },
        data: {
          label: "Create tasks",
          language: "text",
          code: "orkai_tasks(action: \"create\", milestone_id: <id>, status: \"pending\") per task",
        },
      },
      {
        id: "implement",
        type: "node-text",
        position: { x: 1400, y: 0 },
        data: {
          label: "Implement",
          content: "Execute work; prefer orkai_search_code before broad file reads.",
        },
      },
      {
        id: "update-status",
        type: "node-code",
        position: { x: 1750, y: 0 },
        data: {
          label: "Update task status",
          language: "text",
          code: "orkai_tasks(action: \"update\", status: \"in_progress\" | \"done\" | \"blocked\")",
        },
      },
      {
        id: "complete",
        type: "node-code",
        position: { x: 2100, y: 0 },
        data: {
          label: "Mark milestone done",
          language: "text",
          code: "orkai_milestone(action: \"update\", status: \"done\") when milestone completes",
        },
      },
    ],
    edges: [
      { id: "e-0", source: "classify", target: "plan", type: "edge-true" },
      { id: "e-1", source: "classify", target: "implement", type: "edge-false" },
      { id: "e-2", source: "plan", target: "milestones", type: "edge-default" },
      { id: "e-3", source: "milestones", target: "tasks", type: "edge-default" },
      { id: "e-4", source: "tasks", target: "implement", type: "edge-default" },
      { id: "e-5", source: "implement", target: "update-status", type: "edge-default" },
      { id: "e-6", source: "update-status", target: "complete", type: "edge-default" },
    ],
  },
}

const SESSION_SAVE: BuiltinWorkflow = {
  name: "Orkai Session Save",
  description: "Wrap-up ritual: summarize work, create orkai session, confirm ID for next session.",
  text: "## Steps\n\n1. **Summarize** — What was done, what's pending, key decisions.\n2. **Save** — `orkai_session(action: \"create\")` with structured markdown body.\n3. **Confirm** — Tell the user the orkai session ID for continuity on the next session.",
  graph: {
    nodes: [
      {
        id: "summarize",
        type: "node-text",
        position: { x: 0, y: 0 },
        data: {
          label: "Summarize session",
          content: "Draft: what was accomplished, pending items, and key decisions.",
        },
      },
      {
        id: "save",
        type: "node-code",
        position: { x: 350, y: 0 },
        data: {
          label: "Create session",
          language: "text",
          code: "orkai_session(action: \"create\", name, description, text, category_ids: [...])",
        },
      },
      {
        id: "confirm",
        type: "node-text",
        position: { x: 700, y: 0 },
        data: {
          label: "Confirm session ID",
          content: "Share the new orkai session ID so the next session can load continuity.",
        },
      },
    ],
    edges: [
      { id: "e-0", source: "summarize", target: "save", type: "edge-default" },
      { id: "e-1", source: "save", target: "confirm", type: "edge-default" },
    ],
  },
}

export const BUILTIN = [SESSION_START, PLANNING, SESSION_SAVE] as const

export function searchNames(result: { content?: ReadonlyArray<{ type: string; text?: string }> }) {
  const text = toolText(result).trim()
  if (!text) return []
  try {
    const parsed = JSON.parse(text) as unknown
    if (typeof parsed !== "object" || parsed === null || !("items" in parsed)) return []
    const items = parsed.items
    if (!Array.isArray(items)) return []
    return items.flatMap((item) => {
      if (typeof item !== "object" || item === null || !("name" in item)) return []
      const name = item.name
      return typeof name === "string" ? [name] : []
    })
  } catch {
    return []
  }
}

export function existsByName(names: string[], name: string) {
  return names.includes(name)
}

export const seedOne = Effect.fn("OrkaiWorkflows.seedOne")(function* (input: {
  workflow: BuiltinWorkflow
  categoryID: string
  endpoint: Endpoint
}) {
  const search = yield* callTool(
    "workflow",
    { action: "search", query: input.workflow.name, limit: 5 },
    input.endpoint,
  ).pipe(
    Effect.catch(() => Effect.succeed({ content: [] })),
  )

  if (existsByName(searchNames(search), input.workflow.name)) return

  yield* callTool(
    "workflow",
    {
      action: "create",
      name: input.workflow.name,
      description: input.workflow.description,
      text: input.workflow.text,
      raw: JSON.stringify(input.workflow.graph),
      category_ids: [input.categoryID],
    },
    input.endpoint,
  )
})

export const seed = Effect.fn("OrkaiWorkflows.seed")(function* (input: {
  directory: string
  config: ConfigV1.Info
  fs: FSUtil.Interface
  endpoint: Endpoint
}) {
  if (!active(input.config)) return

  const hits = yield* input.fs.findUp(PROJECT_FILE, input.directory).pipe(
    Effect.catch(() => Effect.succeed([] as string[])),
  )
  const projectFile = hits[0]
  const projectText = projectFile
    ? yield* input.fs.readFileStringSafe(projectFile).pipe(Effect.catch(() => Effect.succeed(undefined)))
    : undefined
  const project = projectText ? parseProjectYaml(projectText) : undefined

  if (!project?.category_id) {
    yield* Effect.logWarning("orkai workflow seed skipped: missing category_id in .orkai.yaml", {
      projectFile: projectFile ? path.relative(input.directory, projectFile) : PROJECT_FILE,
    })
    return
  }

  for (const workflow of BUILTIN) {
    yield* seedOne({ workflow, categoryID: project.category_id, endpoint: input.endpoint }).pipe(
      Effect.catch((cause) =>
        Effect.gen(function* () {
          yield* Effect.logWarning("orkai workflow seed failed", {
            workflow: workflow.name,
            error: cause instanceof Error ? cause.message : String(cause),
          })
        }),
      ),
    )
  }
})

export * as OrkaiWorkflows from "./workflows"
