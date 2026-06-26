import { describe, expect } from "bun:test"
import { Effect, Layer, Stream } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { Installation } from "../../src/installation"
import { Distribution } from "../../src/distribution"
import { AppProcess } from "@opencode-ai/core/process"
import { testEffect } from "../lib/effect"

const encoder = new TextEncoder()

function mockHttpClient(handler: (request: HttpClientRequest.HttpClientRequest) => Response) {
  const client = HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request, handler(request))))
  return Layer.succeed(HttpClient.HttpClient, client)
}

function mockSpawner(
  handler: (cmd: string, args: readonly string[]) => string | { code: number; stdout?: string; stderr?: string } = () =>
    "",
) {
  const spawner = ChildProcessSpawner.make((command) => {
    const std = ChildProcess.isStandardCommand(command) ? command : undefined
    const result = handler(std?.command ?? "", std?.args ?? [])
    const output = typeof result === "string" ? { code: 0, stdout: result, stderr: "" } : result
    return Effect.succeed(
      ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(0),
        exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(output.code)),
        isRunning: Effect.succeed(false),
        kill: () => Effect.void,
        stdin: { [Symbol.for("effect/Sink/TypeId")]: Symbol.for("effect/Sink/TypeId") } as any,
        stdout: output.stdout ? Stream.make(encoder.encode(output.stdout)) : Stream.empty,
        stderr: output.stderr ? Stream.make(encoder.encode(output.stderr)) : Stream.empty,
        all: Stream.empty,
        getInputFd: () => ({ [Symbol.for("effect/Sink/TypeId")]: Symbol.for("effect/Sink/TypeId") }) as any,
        getOutputFd: () => Stream.empty,
        unref: Effect.succeed(Effect.void),
      }),
    )
  })
  return Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner)
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

function testLayer(httpHandler: (request: HttpClientRequest.HttpClientRequest) => Response) {
  const appProcess = AppProcess.layer.pipe(Layer.provide(mockSpawner()))
  return Installation.layer.pipe(Layer.provide(mockHttpClient(httpHandler)), Layer.provide(appProcess))
}

describe("installation", () => {
  describe("latest", () => {
    testEffect(testLayer(() => jsonResponse({ tag_name: "v1.2.3" }))).effect(
      "reads release version from fork GitHub releases",
      () =>
        Effect.gen(function* () {
          const result = yield* Installation.use.latest("unknown")
          expect(result).toBe("1.2.3")
        }),
    )

    testEffect(
      testLayer((request) => {
        expect(request.url).toBe(Distribution.latestReleaseApiUrl)
        return jsonResponse({ tag_name: "v4.0.0-beta.1" })
      }),
    ).effect("uses fork GitHub API for all install methods", () =>
      Effect.gen(function* () {
        const result = yield* Installation.use.latest("npm")
        expect(result).toBe("4.0.0-beta.1")
      }),
    )
  })

  describe("upgrade", () => {
    testEffect(
      testLayer((request) => {
        if (request.url === Distribution.latestReleaseApiUrl) return jsonResponse({ tag_name: "v9.9.9" })
        if (request.url.includes("/releases/download/")) return new Response(null, { status: 404 })
        return jsonResponse({})
      }),
    ).effect("uses fork GitHub release download URL", () =>
      Effect.gen(function* () {
        const target = Distribution.releaseTarget()
        if (!target) return
        const error = yield* Effect.flip(Installation.use.upgrade("unknown", "9.9.9"))
        expect(error).toBeInstanceOf(Installation.UpgradeFailedError)
        expect(error.stderr).toContain(Distribution.releasesUrl)
      }),
    )
  })
})
