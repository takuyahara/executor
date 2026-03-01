import {
  RuntimeAdapterError,
  invokeRuntimeToolCallResult,
} from "@executor-v2/engine";
import type {
  RuntimeToolCallRequest,
  RuntimeToolCallResult,
} from "@executor-v2/sdk";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as ParseResult from "effect/ParseResult";
import * as Schema from "effect/Schema";

import { internal } from "./_generated/api";
import { httpAction, type ActionCtx } from "./_generated/server";
import { createConvexSourceToolRegistry } from "./source_tool_registry";

class RuntimeToolCallBadRequestError extends Data.TaggedError(
  "RuntimeToolCallBadRequestError",
)<{
  message: string;
  details: string;
}> {}

const RuntimeToolCallCredentialContextSchema = Schema.Struct({
  workspaceId: Schema.String,
  sourceKey: Schema.String,
  organizationId: Schema.optional(Schema.NullOr(Schema.String)),
  accountId: Schema.optional(Schema.NullOr(Schema.String)),
});

const RuntimeToolCallRequestSchema = Schema.Struct({
  runId: Schema.String,
  callId: Schema.String,
  toolPath: Schema.String,
  input: Schema.optional(
    Schema.Record({
      key: Schema.String,
      value: Schema.Unknown,
    }),
  ),
  credentialContext: Schema.optional(RuntimeToolCallCredentialContextSchema),
});

const decodeRuntimeToolCallRequest = Schema.decodeUnknown(RuntimeToolCallRequestSchema);

const readConfiguredWorkspaceId = (value: string | undefined): string => {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : "ws_local";
};

const fallbackWorkspaceId = readConfiguredWorkspaceId(process.env.CONVEX_WORKSPACE_ID);

const badRequest = (message: string): Response =>
  Response.json(
    {
      ok: false,
      kind: "failed",
      error: message,
    } satisfies RuntimeToolCallResult,
    { status: 400 },
  );

const formatBadRequestMessage = (error: RuntimeToolCallBadRequestError): string =>
  error.details.length > 0 ? `${error.message}: ${error.details}` : error.message;

const formatRuntimeAdapterError = (error: RuntimeAdapterError): string =>
  error.details ? `${error.message}: ${error.details}` : error.message;

const formatUnknownDetails = (cause: unknown): string => String(cause);

const decodeToolCallRequest = (request: Request): Effect.Effect<RuntimeToolCallRequest, RuntimeToolCallBadRequestError> =>
  Effect.gen(function* () {
    const body = yield* Effect.tryPromise({
      try: () => request.json(),
      catch: (cause) =>
        new RuntimeToolCallBadRequestError({
          message: "Invalid runtime callback request body",
          details: formatUnknownDetails(cause),
        }),
    });

    return yield* decodeRuntimeToolCallRequest(body).pipe(
      Effect.mapError(
        (cause) =>
          new RuntimeToolCallBadRequestError({
            message: "Runtime callback request body is invalid",
            details: ParseResult.TreeFormatter.formatErrorSync(cause),
          }),
      ),
    );
  });

const readWorkspaceIdFromCallbackUrl = (request: Request): string | null => {
  const value = new URL(request.url).searchParams.get("workspaceId")?.trim();
  return value && value.length > 0 ? value : null;
};

const resolveWorkspaceIdForToolCall = (
  ctx: ActionCtx,
  request: Request,
  input: RuntimeToolCallRequest,
): Effect.Effect<string, never> =>
  Effect.gen(function* () {
    const contextWorkspaceId = input.credentialContext?.workspaceId?.trim();
    if (contextWorkspaceId) {
      return contextWorkspaceId;
    }

    const callbackWorkspaceId = readWorkspaceIdFromCallbackUrl(request);
    if (callbackWorkspaceId) {
      return callbackWorkspaceId;
    }

    const runWorkspaceId = yield* Effect.tryPromise({
      try: () =>
        ctx.runQuery(internal.task_runs.getTaskRunWorkspaceId, {
          runId: input.runId,
        }),
      catch: () => null,
    }).pipe(Effect.orElseSucceed(() => null));

    if (typeof runWorkspaceId === "string" && runWorkspaceId.trim().length > 0) {
      return runWorkspaceId.trim();
    }

    return fallbackWorkspaceId;
  });

const handleToolCallHttpEffect = (
  ctx: ActionCtx,
  request: Request,
): Effect.Effect<Response, never> =>
  Effect.gen(function* () {
    const input = yield* decodeToolCallRequest(request);
    const workspaceId = yield* resolveWorkspaceIdForToolCall(ctx, request, input);

    const toolRegistry = createConvexSourceToolRegistry(ctx, workspaceId);

    const result = yield* invokeRuntimeToolCallResult(toolRegistry, input).pipe(
      Effect.catchTag("RuntimeAdapterError", (error) =>
        Effect.succeed<RuntimeToolCallResult>({
          ok: false,
          kind: "failed",
          error: formatRuntimeAdapterError(error),
        }),
      ),
    );

    return Response.json(result, { status: 200 });
  }).pipe(
    Effect.catchTag("RuntimeToolCallBadRequestError", (error) =>
      Effect.succeed(badRequest(formatBadRequestMessage(error))),
    ),
  );

export const handleToolCallHttp = httpAction((ctx, request) =>
  Effect.runPromise(handleToolCallHttpEffect(ctx, request)),
);
