import {
  RuntimeExecutionPortError,
  RuntimeExecutionPortService,
} from "@executor-v2/domain";
import {
  RuntimeAdapterRegistryService,
  ToolProviderRegistryService,
  type RuntimeExecuteError,
} from "@executor-v2/engine";
import type { ExecuteRunInput } from "@executor-v2/sdk";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export type PmRuntimeExecutionPortOptions = {
  defaultRuntimeKind: string;
};

export const PmRuntimeExecutionPortLive = (
  options: PmRuntimeExecutionPortOptions,
): Layer.Layer<
  RuntimeExecutionPortService,
  never,
  RuntimeAdapterRegistryService | ToolProviderRegistryService
> =>
  Layer.effect(
    RuntimeExecutionPortService,
    Effect.gen(function* () {
      const runtimeAdapters = yield* RuntimeAdapterRegistryService;
      const toolProviders = yield* ToolProviderRegistryService;

      return RuntimeExecutionPortService.of({
        execute: (input: ExecuteRunInput) =>
          Effect.gen(function* () {
            const runtimeAdapter = yield* runtimeAdapters
              .get(options.defaultRuntimeKind)
              .pipe(
                Effect.mapError(
                  (error) =>
                    new RuntimeExecutionPortError({
                      operation: "resolve_runtime_adapter",
                      message: error.message,
                      details: null,
                    }),
                ),
              );

            const isAvailable = yield* runtimeAdapter.isAvailable();
            if (!isAvailable) {
              return yield* new RuntimeExecutionPortError({
                operation: "runtime_available",
                message: `Runtime '${options.defaultRuntimeKind}' is not available in this pm process.`,
                details: null,
              });
            }

            return yield* runtimeAdapter
              .execute({
                code: input.code,
                timeoutMs: input.timeoutMs,
                tools: [],
              })
              .pipe(
                Effect.provideService(ToolProviderRegistryService, toolProviders),
                Effect.mapError(
                  (error: RuntimeExecuteError) =>
                    new RuntimeExecutionPortError({
                      operation: "runtime_execute",
                      message: error.message,
                      details: error.details,
                    }),
                ),
              );
          }),
      });
    }),
  );
