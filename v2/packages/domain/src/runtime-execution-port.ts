import type { ExecuteRunInput } from "@executor-v2/sdk";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import type * as Effect from "effect/Effect";

export class RuntimeExecutionPortError extends Data.TaggedError(
  "RuntimeExecutionPortError",
)<{
  operation: string;
  message: string;
  details: string | null;
}> {}

export interface RuntimeExecutionPort {
  execute(input: ExecuteRunInput): Effect.Effect<unknown, RuntimeExecutionPortError>;
}

export class RuntimeExecutionPortService extends Context.Tag(
  "@executor-v2/domain/RuntimeExecutionPortService",
)<RuntimeExecutionPortService, RuntimeExecutionPort>() {}
