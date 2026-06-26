import { isRecord } from "@/util/record"

export interface ProjectConfig {
  name?: string
  category_id?: string
}

export function parseProjectYaml(text: string): ProjectConfig | undefined {
  const parsed = Bun.YAML.parse(text)
  if (!isRecord(parsed)) return undefined
  const project = parsed.project
  if (!isRecord(project)) return undefined
  return {
    name: typeof project.name === "string" ? project.name : undefined,
    category_id: typeof project.category_id === "string" ? project.category_id : undefined,
  }
}

export * as OrkaiProjectConfig from "./project-config"
