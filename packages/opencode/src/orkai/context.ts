import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Config } from "@/config/config"
import { InstanceState } from "@/effect/instance-state"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Context, Effect, Layer } from "effect"
import { OrkaiPrompt } from "./prompt"
import { errorMessage } from "@/util/error"

export interface Interface {
  readonly get: () => Effect.Effect<string | undefined>
  readonly invalidate: () => Effect.Effect<void>
  readonly refresh: () => Effect.Effect<string | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/OrkaiContext") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const fsys = yield* FSUtil.Service
    const cache = yield* InstanceState.make<string | undefined>(
      Effect.fn("OrkaiContext.load")(function* (ctx) {
        const cfg = yield* config.get()
        return yield* OrkaiPrompt.prefetch({ directory: ctx.directory, config: cfg, fs: fsys }).pipe(
            Effect.catch((cause) =>
              Effect.gen(function* () {
                yield* Effect.logWarning("orkai session start prefetch failed", {
                  error: errorMessage(cause),
                })
                return undefined
              }),
            ),
        )
      }),
    )

    return Service.of({
      get: Effect.fn("OrkaiContext.get")(function* () {
        return yield* InstanceState.get(cache)
      }),
      invalidate: Effect.fn("OrkaiContext.invalidate")(function* () {
        yield* InstanceState.invalidate(cache)
      }),
      refresh: Effect.fn("OrkaiContext.refresh")(function* () {
        yield* InstanceState.invalidate(cache)
        return yield* InstanceState.get(cache)
      }),
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Config.defaultLayer), Layer.provide(FSUtil.defaultLayer))

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [Config.node, FSUtil.node],
})

export * as OrkaiContext from "./context"
