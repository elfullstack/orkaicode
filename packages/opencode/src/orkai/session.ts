import path from "path"
import type { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import type { FSUtil } from "@opencode-ai/core/fs-util"
import { Effect } from "effect"
import { callTool, paths, resolveEndpointFromFiles } from "./mcp"
import { active, toolText } from "./prompt"
import { parseProjectYaml } from "./project-config"
import type { SessionID } from "@/session/schema"

const PROJECT_FILE = ".orkai.yaml"
const DEFAULT_TITLE = /^(New session - |Child session - )\d{4}-\d{2}-\d{2}T/

export function compactSessionName(title: string) {
  const topic = DEFAULT_TITLE.test(title) ? "Auto-compact" : title
  return `Session: ${topic} - ${new Date().toISOString().slice(0, 10)}`
}

export function compactSessionText(input: { summary: string; sessionID: SessionID; auto: boolean }) {
  return [
    "## What was done",
    input.summary,
    "",
    "## Pending",
    "Work continues after compaction in the same opencode session.",
    "",
    "## Key decisions",
    "See summary above.",
    "",
    "## Meta",
    `- opencode session: ${input.sessionID}`,
    `- compaction: ${input.auto ? "auto" : "manual"}`,
  ].join("\n")
}

export function parseSessionEntityId(result: { content?: ReadonlyArray<{ type: string; text?: string }> }) {
  const text = toolText(result).trim()
  if (!text) return undefined
  try {
    const parsed = JSON.parse(text) as unknown
    if (typeof parsed === "object" && parsed !== null && "id" in parsed && typeof parsed.id === "string") {
      return parsed.id
    }
  } catch {
    const match = text.match(/"id"\s*:\s*"([^"]+)"/)
    if (match?.[1]) return match[1]
  }
  return undefined
}

function resolveProject(input: { directory: string; fs: FSUtil.Interface }) {
  return Effect.gen(function* () {
    const hits = yield* input.fs.findUp(PROJECT_FILE, input.directory).pipe(
      Effect.catch(() => Effect.succeed([] as string[])),
    )
    const projectFile = hits[0]
    const projectText = projectFile
      ? yield* input.fs.readFileStringSafe(projectFile).pipe(Effect.catch(() => Effect.succeed(undefined)))
      : undefined
    return {
      project: projectText ? parseProjectYaml(projectText) : undefined,
      projectFile,
    }
  })
}

function resolveEndpoint(fs: FSUtil.Interface) {
  return Effect.gen(function* () {
    const credentials = yield* fs
      .readFileStringSafe(paths.credentials())
      .pipe(Effect.catch(() => Effect.succeed(undefined)))
    if (!credentials) return undefined
    const runtime = yield* fs.readFileStringSafe(paths.runtime()).pipe(Effect.catch(() => Effect.succeed(undefined)))
    return resolveEndpointFromFiles({ credentials, runtime })
  })
}

export const saveCompactSummary = Effect.fn("OrkaiSession.saveCompactSummary")(function* (input: {
  directory: string
  config: ConfigV1.Info
  fs: FSUtil.Interface
  summary: string
  sessionID: SessionID
  title: string
  auto: boolean
}) {
  if (!active(input.config)) return undefined

  const endpoint = yield* resolveEndpoint(input.fs)
  if (!endpoint) return undefined

  const { project, projectFile } = yield* resolveProject({ directory: input.directory, fs: input.fs })
  if (!project?.category_id) {
    yield* Effect.logWarning("orkai compact save skipped: missing category_id in .orkai.yaml", {
      projectFile: projectFile ? path.relative(input.directory, projectFile) : PROJECT_FILE,
    })
    return undefined
  }

  const result = yield* callTool(
    "session",
    {
      action: "create",
      name: compactSessionName(input.title),
      description: input.auto ? "Auto-compact session save" : "Manual compact session save",
      text: compactSessionText({
        summary: input.summary,
        sessionID: input.sessionID,
        auto: input.auto,
      }),
      category_ids: [project.category_id],
    },
    endpoint,
  ).pipe(
    Effect.catch((cause) =>
      Effect.gen(function* () {
        yield* Effect.logWarning("orkai compact save failed", {
          sessionID: input.sessionID,
          error: cause instanceof Error ? cause.message : String(cause),
        })
        return undefined
      }),
    ),
  )

  if (!result) return undefined

  const id = parseSessionEntityId(result)
  if (id) yield* Effect.logInfo("orkai session saved after compact", { sessionID: input.sessionID, orkaiSessionID: id })
  return id
})

export * as OrkaiSession from "./session"
