import {
  RunExecutionService,
  RunExecutionServiceLive,
} from "@executor-v2/domain";
import type { ExecuteRunInput, ExecuteRunResult } from "@executor-v2/sdk";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ConvexRuntimeExecutionPortLive } from "./runtime_execution_port";

const ConvexRunExecutionLive = RunExecutionServiceLive().pipe(
  Layer.provide(ConvexRuntimeExecutionPortLive),
);

export const executeRunImpl = (
  input: ExecuteRunInput,
): Effect.Effect<ExecuteRunResult> =>
  Effect.gen(function* () {
    const runExecutionService = yield* RunExecutionService;
    return yield* runExecutionService.executeRun(input);
  }).pipe(Effect.provide(ConvexRunExecutionLive));
