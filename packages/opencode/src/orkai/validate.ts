import path from "path"
import { which } from "@opencode-ai/core/util/which"
import type { FSUtil } from "@opencode-ai/core/fs-util"
import { Effect, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { ValidationFailedError } from "./error"
import { credentialsPath, runtimePath } from "./credentials"
import { disabled, resolveEndpointFromFiles } from "./mcp"
import { parseProjectYaml } from "./project-config"
import type { ConfigV1 } from "@opencode-ai/core/v1/config/config"

const PROJECT_FILE = ".orkai.yaml"

type Spawner = (typeof ChildProcessSpawner)["ChildProcessSpawner"]["Service"]

function fail(reason: string, hint?: string) {
  return Effect.fail(new ValidationFailedError({ reason, hint }))
}

function runOrkai(spawner: Spawner, args: string[], cwd?: string) {
  return Effect.gen(function* () {
    const binary = which("orkai")
    if (!binary) {
      return yield* fail("orkai binary not found in PATH", "Install orkai: https://github.com/beforethesprint/orkai")
    }

    const handle = yield* spawner.spawn(
      ChildProcess.make(binary, args, { cwd, extendEnv: true, stdin: "ignore" }),
    )
    const [stdout, stderr] = yield* Effect.all(
      [Stream.mkString(Stream.decodeText(handle.stdout)), Stream.mkString(Stream.decodeText(handle.stderr))],
      { concurrency: 2 },
    )
    const code = yield* handle.exitCode
    return { code, stdout, stderr }
  }).pipe(Effect.scoped)
}

function ensureDaemon(spawner: Spawner) {
  return Effect.gen(function* () {
    const status = yield* runOrkai(spawner, ["status"])
    if (status.code === 0 && status.stdout.includes("healthy")) return

    const start = yield* runOrkai(spawner, ["start"])
    const alreadyRunning =
      start.stdout.includes("already running") || start.stderr.includes("already running")
    if (start.code !== 0 && !alreadyRunning) {
      return yield* fail(
        "orkai daemon is not running",
        start.stderr.trim() || start.stdout.trim() || "Run `orkai start` or `orkai serve` and try again.",
      )
    }

    const recheck = yield* runOrkai(spawner, ["status"])
    if (recheck.code !== 0 || !recheck.stdout.includes("healthy")) {
      return yield* fail("orkai daemon failed health check", "Run `orkai status` for details.")
    }
  })
}

function ensureProjectConfig(spawner: Spawner, fs: FSUtil.Interface, directory: string) {
  return Effect.gen(function* () {
    const hits = yield* fs.findUp(PROJECT_FILE, directory)
    if (hits[0]) return hits[0]

    const init = yield* runOrkai(spawner, ["init"], directory)
    if (init.code !== 0) {
      return yield* fail(
        `Missing ${PROJECT_FILE} in project`,
        init.stderr.trim() || init.stdout.trim() || `Run \`orkai init\` in ${directory} and try again.`,
      )
    }

    const created = yield* fs.findUp(PROJECT_FILE, directory)
    if (!created[0]) {
      return yield* fail(
        `orkai init did not create ${PROJECT_FILE}`,
        `Run \`orkai init\` in ${directory} and try again.`,
      )
    }
    return created[0]
  })
}

export const validate = Effect.fn("Orkai.validate")(function* (input: {
  directory: string
  config: ConfigV1.Info
  fs: FSUtil.Interface
  spawner: Spawner
}) {
  if (disabled(input.config)) return

  if (!which("orkai")) {
    return yield* fail(
      "orkai binary not found in PATH",
      "Install orkai and ensure it is on PATH, or set OPENCODE_DISABLE_ORKAI=1 to skip orkai integration.",
    )
  }

  const creds = yield* input.fs.readFileStringSafe(credentialsPath())
  if (!creds) {
    return yield* fail(
      "orkai credentials not found",
      `Run \`orkai login\` or \`orkai serve\` first (~/.orkai/credentials).`,
    )
  }

  const endpoint = resolveEndpointFromFiles({
    credentials: creds,
    runtime: yield* input.fs.readFileStringSafe(runtimePath()),
  })
  if (!endpoint) {
    return yield* fail("orkai credentials are invalid", `Check ${credentialsPath()} and run \`orkai login\` again.`)
  }

  yield* ensureDaemon(input.spawner)
  const projectFile = yield* ensureProjectConfig(input.spawner, input.fs, input.directory)
  const projectText = yield* input.fs.readFileStringSafe(projectFile)
  if (!projectText || !parseProjectYaml(projectText)) {
    return yield* fail(
      `Invalid ${PROJECT_FILE}`,
      `Fix or delete ${path.relative(input.directory, projectFile) || PROJECT_FILE} and run \`orkai init\`.`,
    )
  }
})

export * as OrkaiValidate from "./validate"
