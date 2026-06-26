import path from "path"
import type { FSUtil } from "@opencode-ai/core/fs-util"
import { Effect } from "effect"
import { parseProjectYaml, type ProjectConfig } from "./project-config"

export const PROJECT_FILE = ".orkai.yaml"

export type Scope = {
  categoryID: string
  projectName: string
  config: ProjectConfig
  projectFile: string
}

export function requireScope(input: {
  project?: ProjectConfig
  projectFile: string
  directory: string
}): { ok: true; scope: Scope } | { ok: false; hint: string } {
  const rel = path.relative(input.directory, input.projectFile) || PROJECT_FILE
  if (!input.project?.category_id?.trim()) {
    return { ok: false, hint: `missing project.category_id in ${rel}` }
  }
  const projectName = input.project.name?.trim()
  if (!projectName) {
    return { ok: false, hint: `missing project.name in ${rel}` }
  }
  return {
    ok: true,
    scope: {
      categoryID: input.project.category_id.trim(),
      projectName,
      config: input.project,
      projectFile: input.projectFile,
    },
  }
}

export const resolve = Effect.fn("OrkaiProjectScope.resolve")(function* (input: {
  directory: string
  fs: FSUtil.Interface
}) {
  const hits = yield* input.fs.findUp(PROJECT_FILE, input.directory).pipe(
    Effect.catch(() => Effect.succeed([] as string[])),
  )
  const projectFile = hits[0]
  if (!projectFile) return undefined

  const projectText = yield* input.fs.readFileStringSafe(projectFile).pipe(Effect.catch(() => Effect.succeed(undefined)))
  const project = projectText ? parseProjectYaml(projectText) : undefined
  const required = requireScope({ project, projectFile, directory: input.directory })
  if (!required.ok) return { scope: undefined, hint: required.hint }

  return { scope: required.scope, hint: undefined }
})

/** Overview includes global standards/skills; keep only project-session continuity sections. */
export function scopedOverviewSections(text: string) {
  const keep = (title: string) =>
    title === "Recent Sessions" || title.includes("User Preferences") || title.includes("Agent Preferences")
  const lines = text.split("\n")
  const out: string[] = []
  let active = false

  for (const line of lines) {
    if (line.startsWith("# ")) {
      out.push(line)
      active = false
      continue
    }
    if (line.startsWith("**Total**")) continue
    if (line.startsWith("## ")) {
      const title = line.slice(3).trim()
      active = keep(title)
      if (active) out.push(line)
      continue
    }
    if (active) out.push(line)
  }

  return out.join("\n").trim()
}

export function overviewArgs(scope: Scope) {
  return { project_name: scope.projectName, category_id: scope.categoryID }
}

export function sessionLatestArgs(scope: Scope) {
  return { action: "latest", category_ids: [scope.categoryID] }
}

export function categoryListArgs(scope: Scope, limit = 20) {
  return { action: "list", category_ids: [scope.categoryID], limit }
}

export function listItemNames(result: { content?: ReadonlyArray<{ type: string; text?: string }> }) {
  const text = result.content?.find((part) => part.type === "text")?.text?.trim() ?? ""
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
