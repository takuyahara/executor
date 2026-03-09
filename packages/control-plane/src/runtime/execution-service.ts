import {
  ControlPlaneBadRequestError,
  ControlPlaneNotFoundError,
  ControlPlaneStorageError,
} from "#api";
import type {
  CreateExecutionPayload,
  ResumeExecutionPayload,
} from "../api/executions/api";
import type { ToolInvoker } from "@executor/codemode-core";
import {
  ExecutionIdSchema,
  type AccountId,
  type Execution,
  type ExecutionEnvelope,
  type ExecutionId,
  type WorkspaceId,
} from "#schema";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import {
  type ResolveExecutionEnvironment,
  ResumeUnsupportedError,
} from "./execution-state";
import {
  LiveExecutionManagerService,
  type LiveExecutionManager,
} from "./live-execution";
import {
  asOperationErrors,
  operationErrors,
  type OperationErrorsLike,
} from "./operation-errors";
import {
  ControlPlaneStore,
  type ControlPlaneStoreShape,
} from "./store";
import { RuntimeExecutionResolverService } from "./workspace-execution-environment";

const executionOps = {
  create: operationErrors("executions.create"),
  get: operationErrors("executions.get"),
  resume: operationErrors("executions.resume"),
} as const;

const serializeJson = (value: unknown): string | null => {
  if (value === undefined) {
    return null;
  }

  return JSON.stringify(value);
};

const ElicitationActionSchema = Schema.Literal("accept", "decline", "cancel");

const ElicitationResponseSchema = Schema.Struct({
  action: ElicitationActionSchema,
  content: Schema.optional(
    Schema.Record({
      key: Schema.String,
      value: Schema.Unknown,
    }),
  ),
});

const decodeElicitationResponse = Schema.decodeUnknown(ElicitationResponseSchema);

const withExecutionInvocationContext = (input: {
  executionId: Execution["id"];
  toolInvoker: ToolInvoker;
}): ToolInvoker => {
  let sequence = 0;

  return {
    invoke: ({ path, args, context }) => {
      sequence += 1;

      return input.toolInvoker.invoke({
        path,
        args,
        context: {
          ...context,
          runId: input.executionId,
          callId:
            typeof context?.callId === "string" && context.callId.length > 0
              ? context.callId
              : `call_${String(sequence)}`,
        },
      });
    },
  };
};

const fetchExecution = (
  store: ControlPlaneStoreShape,
  input: {
    workspaceId: Execution["workspaceId"];
    executionId: Execution["id"];
    operation: OperationErrorsLike;
  },
): Effect.Effect<Execution, ControlPlaneNotFoundError | ControlPlaneStorageError> =>
  Effect.gen(function* () {
    const errors = asOperationErrors(input.operation);
    const existing = yield* errors.mapStorage(
      store.executions.getByWorkspaceAndId(input.workspaceId, input.executionId),
    );

    if (Option.isNone(existing)) {
      return yield* Effect.fail(
        errors.notFound(
          "Execution not found",
          `workspaceId=${input.workspaceId} executionId=${input.executionId}`,
        ),
      );
    }

    return existing.value;
  });

const fetchExecutionEnvelope = (
  store: ControlPlaneStoreShape,
  input: {
    workspaceId: Execution["workspaceId"];
    executionId: Execution["id"];
    operation: OperationErrorsLike;
  },
): Effect.Effect<ExecutionEnvelope, ControlPlaneNotFoundError | ControlPlaneStorageError> =>
  Effect.gen(function* () {
    const errors = asOperationErrors(input.operation);
    const execution = yield* fetchExecution(store, input);
    const pendingInteraction = yield* errors.child("pending_interaction").mapStorage(
      store.executionInteractions.getPendingByExecutionId(input.executionId),
    );

    return {
      execution,
      pendingInteraction: Option.isSome(pendingInteraction) ? pendingInteraction.value : null,
    };
  });

const createExecutionWithDependencies = (
  store: ControlPlaneStoreShape,
  executionResolver: ResolveExecutionEnvironment,
  liveExecutionManager: LiveExecutionManager,
  input: {
    workspaceId: WorkspaceId;
    payload: CreateExecutionPayload;
    createdByAccountId: AccountId;
  },
) =>
  Effect.gen(function* () {
    const code = input.payload.code;
    const now = Date.now();
    const execution: Execution = {
      id: ExecutionIdSchema.make(`exec_${crypto.randomUUID()}`),
      workspaceId: input.workspaceId,
      createdByAccountId: input.createdByAccountId,
      status: "pending",
      code,
      resultJson: null,
      errorText: null,
      logsJson: null,
      startedAt: null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    yield* executionOps.create.child("insert").mapStorage(
      store.executions.insert(execution),
    );

    const running = yield* executionOps.create.child("mark_running").mapStorage(
      store.executions.update(execution.id, {
        status: "running",
        startedAt: now,
        updatedAt: now,
      }),
    );

    if (Option.isNone(running)) {
      return yield* Effect.fail(
        executionOps.create.notFound(
          "Execution not found after insert",
          `executionId=${execution.id}`,
        ),
      );
    }

    const environment = yield* executionResolver({
      workspaceId: input.workspaceId,
      accountId: input.createdByAccountId,
      executionId: execution.id,
      onElicitation: liveExecutionManager.createOnElicitation({
        rows: store,
        executionId: execution.id,
      }),
    }).pipe(
      Effect.mapError((error) =>
        executionOps.create.child("environment").unknownStorage(
          error,
          "Execution environment resolution failed",
        ),
      ),
    );

    const nextState = yield* liveExecutionManager.registerStateWaiter(execution.id);
    const toolInvoker = withExecutionInvocationContext({
      executionId: execution.id,
      toolInvoker: environment.toolInvoker,
    });

    yield* Effect.sync(() => {
      Effect.runFork(
        environment.executor.execute(code, toolInvoker).pipe(
          Effect.flatMap((outcome) => {
            const completedAt = Date.now();
            return executionOps.create.child("complete").mapStorage(
              store.executions.update(execution.id, {
                status: outcome.error ? "failed" : "completed",
                resultJson: serializeJson(outcome.result),
                errorText: outcome.error ?? null,
                logsJson: serializeJson(outcome.logs ?? null),
                completedAt,
                updatedAt: completedAt,
              }),
            ).pipe(
              Effect.flatMap((updated) =>
                Option.isNone(updated)
                  ? Effect.fail(
                      executionOps.create.notFound(
                        "Execution not found after completion",
                        `executionId=${execution.id}`,
                      ),
                    )
                  : Effect.succeed(updated.value),
              ),
              Effect.flatMap((updated) =>
                liveExecutionManager.finishRun({
                  executionId: execution.id,
                  state: updated.status === "completed" ? "completed" : "failed",
                }).pipe(Effect.as(updated)),
              ),
            );
          }),
          Effect.catchAll((error) => {
            const completedAt = Date.now();
            return executionOps.create.child("complete_error").mapStorage(
              store.executions.update(execution.id, {
                status: "failed",
                errorText: error instanceof Error ? error.message : String(error),
                completedAt,
                updatedAt: completedAt,
              }),
            ).pipe(
              Effect.zipRight(
                liveExecutionManager.finishRun({
                  executionId: execution.id,
                  state: "failed",
                }),
              ),
              Effect.catchAll(() => liveExecutionManager.clearRun(execution.id)),
            );
          }),
        ),
      );
    });

    yield* Deferred.await(nextState);

    return yield* fetchExecutionEnvelope(store, {
      workspaceId: input.workspaceId,
      executionId: execution.id,
      operation: executionOps.create,
    });
  });

export const createExecution = (input: {
  workspaceId: WorkspaceId;
  payload: CreateExecutionPayload;
  createdByAccountId: AccountId;
}) =>
  Effect.gen(function* () {
    const store = yield* ControlPlaneStore;
    const executionResolver = yield* RuntimeExecutionResolverService;
    const liveExecutionManager = yield* LiveExecutionManagerService;

    return yield* createExecutionWithDependencies(
      store,
      executionResolver,
      liveExecutionManager,
      input,
    );
  });

export const getExecution = (input: {
  workspaceId: WorkspaceId;
  executionId: ExecutionId;
}) =>
  Effect.flatMap(ControlPlaneStore, (store) =>
    fetchExecutionEnvelope(store, {
      workspaceId: input.workspaceId,
      executionId: input.executionId,
      operation: executionOps.get,
    })
  );

export const resumeExecution = (input: {
  workspaceId: WorkspaceId;
  executionId: ExecutionId;
  payload: ResumeExecutionPayload;
  resumedByAccountId: AccountId;
}) =>
  Effect.gen(function* () {
    const store = yield* ControlPlaneStore;
    const liveExecutionManager = yield* LiveExecutionManagerService;

    const existing = yield* fetchExecutionEnvelope(store, {
      workspaceId: input.workspaceId,
      executionId: input.executionId,
      operation: "executions.resume",
    });

    if (existing.execution.status !== "waiting_for_interaction") {
      return yield* Effect.fail(
        executionOps.resume.badRequest(
          "Execution is not waiting for interaction",
          `executionId=${input.executionId} status=${existing.execution.status}`,
        ),
      );
    }

    const responseJson = input.payload.responseJson;
    const response =
      responseJson === undefined
        ? { action: "accept" as const }
        : yield* Effect.try({
            try: () => JSON.parse(responseJson),
            catch: (error) =>
              executionOps.resume.badRequest(
                "Invalid responseJson",
                error instanceof Error ? error.message : String(error),
              ),
          }).pipe(
            Effect.flatMap((decoded) =>
              decodeElicitationResponse(decoded).pipe(
                Effect.mapError((error) =>
                  executionOps.resume.badRequest(
                    "Invalid responseJson",
                    String(error),
                  ),
                ),
              ),
            ),
          );

    const nextState = yield* liveExecutionManager.registerStateWaiter(input.executionId);
    const resumed = yield* liveExecutionManager.resolveInteraction({
      executionId: input.executionId,
      response,
    });

    if (!resumed) {
      return yield* Effect.fail(
        executionOps.resume.badRequest(
          "Resume is unavailable for this execution",
          `executionId=${input.executionId} mode=${new ResumeUnsupportedError({ executionId: input.executionId })._tag}`,
        ),
      );
    }

    yield* Deferred.await(nextState);

    return yield* fetchExecutionEnvelope(store, {
      workspaceId: input.workspaceId,
      executionId: input.executionId,
      operation: executionOps.resume,
    });
  });
