import { Schema } from "effect"
import { NamedError } from "@opencode-ai/core/util/error"

export class ValidationFailedError extends Schema.TaggedErrorClass<ValidationFailedError>()(
  "Orkai.ValidationFailedError",
  {
    reason: Schema.String,
    hint: Schema.optional(Schema.String),
  },
) {
  override get message() {
    return this.hint ? `${this.reason}\n${this.hint}` : this.reason
  }
}

export const CallFailedError = NamedError.create("OrkaiCallFailedError", {
  tool: Schema.String,
  detail: Schema.String,
})

export * as OrkaiError from "./error"
