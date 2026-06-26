import os from "os"
import path from "path"
import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { ChildProcessSpawner } from "effect/unstable/process"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { callTool, resolveEndpointFromFiles } from "../../src/orkai/mcp"
import { OrkaiValidate } from "../../src/orkai/validate"

const live = process.env.ORKAI_LIVE_TEST === "1"
const repoRoot = path.join(import.meta.dir, "../../..")

function withRealOrkaiHome<T>(run: () => Promise<T>) {
  const prevDisable = process.env.OPENCODE_DISABLE_ORKAI
  const prevHome = process.env.OPENCODE_TEST_HOME
  delete process.env.OPENCODE_DISABLE_ORKAI
  process.env.OPENCODE_TEST_HOME = os.homedir()
  return run().finally(() => {
    if (prevDisable === undefined) delete process.env.OPENCODE_DISABLE_ORKAI
    else process.env.OPENCODE_DISABLE_ORKAI = prevDisable
    if (prevHome === undefined) delete process.env.OPENCODE_TEST_HOME
    else process.env.OPENCODE_TEST_HOME = prevHome
  })
}

function liveEndpoint() {
  const home = os.homedir()
  const credentials = Bun.file(path.join(home, ".orkai", "credentials")).text()
  const runtime = Bun.file(path.join(home, ".orkai", "runtime.json")).text()
  return Promise.all([credentials, runtime]).then(([credentialsText, runtimeText]) =>
    resolveEndpointFromFiles({ credentials: credentialsText, runtime: runtimeText }),
  )
}

describe.skipIf(!live)("orkai live", () => {
  test("validate passes for orkaicode repo", () =>
    withRealOrkaiHome(() =>
      Effect.runPromise(
        Effect.gen(function* () {
          const fs = yield* FSUtil.Service
          const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
          yield* OrkaiValidate.validate({
            directory: repoRoot,
            config: {},
            fs,
            spawner,
          })
        }).pipe(Effect.provide(Layer.mergeAll(FSUtil.defaultLayer, CrossSpawnSpawner.defaultLayer))),
      ),
    ),
  )

  test("callTool overview reaches live daemon", () =>
    withRealOrkaiHome(async () => {
      const endpoint = await liveEndpoint()
      expect(endpoint).toBeDefined()

      const result = await Effect.runPromise(callTool("overview", {}, endpoint!))
      const text = result.content?.find((part) => part.type === "text")?.text ?? ""
      expect(text).toContain("orkai v2")
    }),
  )
})
