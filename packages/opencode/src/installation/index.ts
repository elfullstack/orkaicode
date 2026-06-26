import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { httpClient } from "@opencode-ai/core/effect/layer-node-platform"
import { Effect, Layer, Schema, Context } from "effect"
import { serviceUse } from "@opencode-ai/core/effect/service-use"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { withTransientReadRetry } from "@/util/effect-http-client"
import { errorMessage } from "@/util/error"
import { ChildProcess } from "effect/unstable/process"
import { AppProcess } from "@opencode-ai/core/process"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { makeRuntime } from "@opencode-ai/core/effect/runtime"
import semver from "semver"
import { InstallationChannel, InstallationVersion } from "@opencode-ai/core/installation/version"
import { InstallationEvent } from "@opencode-ai/schema/installation-event"
import { Distribution } from "@/distribution"

export type Method = "curl" | "npm" | "yarn" | "pnpm" | "bun" | "brew" | "scoop" | "choco" | "unknown"

export type ReleaseType = "patch" | "minor" | "major"

export const Event = InstallationEvent

export function getReleaseType(current: string, latest: string): ReleaseType {
  const currMajor = semver.major(current)
  const currMinor = semver.minor(current)
  const newMajor = semver.major(latest)
  const newMinor = semver.minor(latest)

  if (newMajor > currMajor) return "major"
  if (newMinor > currMinor) return "minor"
  return "patch"
}

export const Info = Schema.Struct({
  version: Schema.String,
  latest: Schema.String,
}).annotate({ identifier: "InstallationInfo" })
export type Info = Schema.Schema.Type<typeof Info>

export function userAgent(client = "cli") {
  return `opencode/${InstallationChannel}/${InstallationVersion}/${client}`
}

export const USER_AGENT = userAgent()

export function isPreview() {
  return InstallationChannel !== "latest"
}

export function isLocal() {
  return InstallationChannel === "local"
}

export class UpgradeFailedError extends Schema.TaggedErrorClass<UpgradeFailedError>()("UpgradeFailedError", {
  stderr: Schema.String,
}) {
  override get message() {
    return this.stderr
  }
}

// Response schema for fork GitHub releases API
const GitHubRelease = Schema.Struct({ tag_name: Schema.String })

export interface Interface {
  readonly info: () => Effect.Effect<Info>
  readonly method: () => Effect.Effect<Method>
  readonly latest: (method?: Method) => Effect.Effect<string>
  readonly upgrade: (method: Method, target: string) => Effect.Effect<void, UpgradeFailedError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Installation") {}

export const use = serviceUse(Service)

export const layer: Layer.Layer<Service, never, HttpClient.HttpClient | AppProcess.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    const httpOk = HttpClient.filterStatusOk(withTransientReadRetry(http))
    const appProcess = yield* AppProcess.Service

    const text = Effect.fnUntraced(
      function* (cmd: string[], opts?: { cwd?: string; env?: Record<string, string> }) {
        const result = yield* appProcess.run(
          ChildProcess.make(cmd[0], cmd.slice(1), {
            cwd: opts?.cwd,
            env: opts?.env,
            extendEnv: true,
          }),
        )
        return result.stdout.toString("utf8")
      },
      Effect.catch(() => Effect.succeed("")),
    )

    const run = Effect.fnUntraced(
      function* (cmd: string[], opts?: { cwd?: string }) {
        const result = yield* appProcess.run(
          ChildProcess.make(cmd[0], cmd.slice(1), {
            cwd: opts?.cwd,
            extendEnv: true,
          }),
        )
        return {
          code: result.exitCode,
          stderr: result.stderr.toString("utf8"),
        }
      },
    )

    const upgradeRelease = Effect.fnUntraced(function* (target: string) {
      const platform = Distribution.releaseTarget()
      if (!platform) {
        return yield* new UpgradeFailedError({ stderr: "Self-update is not supported on this platform." })
      }

      const url = Distribution.releaseDownloadUrl(target, platform)
      const tmp = path.join(os.tmpdir(), `opencode-upgrade-${process.pid}`)
      const archive = path.join(tmp, Distribution.releaseArchiveFilename(platform))
      const extract = path.join(tmp, "extract")

      yield* Effect.tryPromise({
        try: () => fs.rm(tmp, { recursive: true, force: true }),
        catch: () => new UpgradeFailedError({ stderr: "Failed to prepare upgrade directory." }),
      })
      yield* Effect.tryPromise({
        try: () => fs.mkdir(tmp, { recursive: true }),
        catch: () => new UpgradeFailedError({ stderr: "Failed to create upgrade directory." }),
      })

      const response = yield* http
        .execute(HttpClientRequest.get(url))
        .pipe(
          Effect.catch((cause) =>
            Effect.fail(
              new UpgradeFailedError({
                stderr: `Failed to download release from ${Distribution.releasesUrl}: ${errorMessage(cause)}`,
              }),
            ),
          ),
        )

      if (response.status === 404) {
        return yield* new UpgradeFailedError({
          stderr: `Release v${target} for ${platform} was not found at ${Distribution.releasesUrl}`,
        })
      }
      if (response.status < 200 || response.status >= 300) {
        return yield* new UpgradeFailedError({
          stderr: `Failed to download release (HTTP ${response.status}). See ${Distribution.releasesUrl}`,
        })
      }

      const body = yield* response.arrayBuffer.pipe(
        Effect.catch((cause) =>
          Effect.fail(new UpgradeFailedError({ stderr: `Failed to read release download: ${errorMessage(cause)}` })),
        ),
      )

      yield* Effect.tryPromise({
        try: () => Bun.write(archive, body),
        catch: (cause) => new UpgradeFailedError({ stderr: `Failed to save release archive: ${errorMessage(cause)}` }),
      })

      yield* Effect.tryPromise({
        try: () => fs.mkdir(extract, { recursive: true }),
        catch: () => new UpgradeFailedError({ stderr: "Failed to create extract directory." }),
      })

      const extractCmd =
        process.platform === "linux"
          ? (["tar", "-xzf", archive, "-C", extract] as const)
          : (["unzip", "-q", archive, "-d", extract] as const)

      const extracted = yield* run([...extractCmd]).pipe(
        Effect.catch((cause) =>
          Effect.fail(new UpgradeFailedError({ stderr: `Failed to extract release: ${errorMessage(cause)}` })),
        ),
      )
      if (extracted.code !== 0) {
        return yield* new UpgradeFailedError({
          stderr: extracted.stderr.trim() || `Failed to extract ${Distribution.releaseArchiveFilename(platform)}`,
        })
      }

      const binaryName = process.platform === "win32" ? "opencode.exe" : "opencode"
      const binary = path.join(extract, binaryName)
      const exists = yield* Effect.tryPromise({
        try: () => fs.stat(binary).then(() => true),
        catch: () => false,
      })
      if (!exists) {
        return yield* new UpgradeFailedError({
          stderr: `Release archive did not contain ${binaryName}. See ${Distribution.releasesUrl}`,
        })
      }

      yield* Effect.tryPromise({
        try: async () => {
          await fs.copyFile(binary, process.execPath)
          await fs.chmod(process.execPath, 0o755)
        },
        catch: (cause) =>
          new UpgradeFailedError({
            stderr: `Failed to install release to ${process.execPath}: ${errorMessage(cause)}`,
          }),
      })

      yield* Effect.tryPromise(() => fs.rm(tmp, { recursive: true, force: true })).pipe(Effect.ignore)

      yield* Effect.logInfo("upgraded", { target, platform, url, execPath: process.execPath })
    })

    const result: Interface = {
      info: Effect.fn("Installation.info")(function* () {
        return {
          version: InstallationVersion,
          latest: yield* result.latest(),
        }
      }),
      method: Effect.fn("Installation.method")(function* () {
        if (process.execPath.includes(path.join(".opencode", "bin"))) return "curl" as Method
        if (process.execPath.includes(path.join(".local", "bin"))) return "curl" as Method
        const exec = process.execPath.toLowerCase()

        const checks: Array<{ name: Method; command: () => Effect.Effect<string> }> = [
          { name: "npm", command: () => text(["npm", "list", "-g", "--depth=0"]) },
          { name: "yarn", command: () => text(["yarn", "global", "list"]) },
          { name: "pnpm", command: () => text(["pnpm", "list", "-g", "--depth=0"]) },
          { name: "bun", command: () => text(["bun", "pm", "ls", "-g"]) },
          { name: "brew", command: () => text(["brew", "list", "--formula", "opencode"]) },
          { name: "scoop", command: () => text(["scoop", "list", "opencode"]) },
          { name: "choco", command: () => text(["choco", "list", "--limit-output", "opencode"]) },
        ]

        checks.sort((a, b) => {
          const aMatches = exec.includes(a.name)
          const bMatches = exec.includes(b.name)
          if (aMatches && !bMatches) return -1
          if (!aMatches && bMatches) return 1
          return 0
        })

        for (const check of checks) {
          const output = yield* check.command()
          const installedName =
            check.name === "brew" || check.name === "choco" || check.name === "scoop" ? "opencode" : "opencode-ai"
          if (output.includes(installedName)) {
            return check.name
          }
        }

        return "unknown" as Method
      }),
      latest: Effect.fn("Installation.latest")(function* () {
        const response = yield* httpOk.execute(
          HttpClientRequest.get(Distribution.latestReleaseApiUrl).pipe(HttpClientRequest.acceptJson),
        )
        const data = yield* HttpClientResponse.schemaBodyJson(GitHubRelease)(response)
        return data.tag_name.replace(/^v/, "")
      }, Effect.orDie),
      upgrade: Effect.fn("Installation.upgrade")(function* (_method: Method, target: string) {
        yield* upgradeRelease(target).pipe(
          Effect.catch((cause) =>
            cause instanceof UpgradeFailedError
              ? Effect.fail(cause)
              : Effect.fail(new UpgradeFailedError({ stderr: errorMessage(cause) })),
          ),
        )
      }),
    }

    return Service.of(result)
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(FetchHttpClient.layer), Layer.provide(AppProcess.defaultLayer))

const { runPromise } = makeRuntime(Service, defaultLayer)

export const latest = (...args: Parameters<Interface["latest"]>) => runPromise((s) => s.latest(...args))
export const method = () => runPromise((s) => s.method())
export const upgrade = (...args: Parameters<Interface["upgrade"]>) => runPromise((s) => s.upgrade(...args))

export const node = LayerNode.make({ service: Service, layer: layer, deps: [httpClient, AppProcess.node] })

export * as Installation from "."
