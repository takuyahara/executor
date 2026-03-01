import type { ExecuteRunInput, ExecuteRunResult } from "@executor-v2/sdk";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  RuntimeExecutionPortService,
  type RuntimeExecutionPort,
  type RuntimeExecutionPortError,
} from "./runtime-execution-port";

export type RunExecutionServiceShape = {
  executeRun: (input: ExecuteRunInput) => Effect.Effect<ExecuteRunResult>;
};

export class RunExecutionService extends Context.Tag(
  "@executor-v2/domain/RunExecutionService",
)<RunExecutionService, RunExecutionServiceShape>() {}

export type RunExecutionServiceOptions = {
  makeRunId?: () => string;
};

export const makeRunExecutionService = (
  runtimeExecutionPort: RuntimeExecutionPort,
  options: RunExecutionServiceOptions,
): RunExecutionServiceShape => ({
  executeRun: Effect.fn("@executor-v2/domain/run-execution.executeRun")(
    function* (input: ExecuteRunInput) {
      const runId = options.makeRunId?.() ?? `run_${crypto.randomUUID()}`;

      return yield* runtimeExecutionPort.execute(input).pipe(
        Effect.match({
          onFailure: (error: RuntimeExecutionPortError): ExecuteRunResult => ({
            runId,
            status: "failed",
            error: error.details ? `${error.message}: ${error.details}` : error.message,
          }),
          onSuccess: (result): ExecuteRunResult => ({
            runId,
            status: "completed",
            result,
          }),
        }),
      );
    },
  ),
});

export const RunExecutionServiceLive = (
  options: RunExecutionServiceOptions = {},
): Layer.Layer<RunExecutionService, never, RuntimeExecutionPortService> =>
  Layer.effect(
    RunExecutionService,
    Effect.gen(function* () {
      const runtimeExecutionPort = yield* RuntimeExecutionPortService;

      return RunExecutionService.of(
        makeRunExecutionService(runtimeExecutionPort, options),
      );
    }),
  );
