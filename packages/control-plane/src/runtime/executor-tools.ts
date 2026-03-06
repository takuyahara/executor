import {
  type ElicitationResponse,
  toTool,
  type ToolMap,
  type ToolPath,
} from "@executor-v3/codemode-core";
import {
  ExecutionIdSchema,
  ExecutionInteractionIdSchema,
  type Source,
  type WorkspaceId,
} from "#schema";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { type RuntimeSourceAuthService } from "./source-auth-service";

const ExecutorSourcesAddInputSchema = Schema.standardSchemaV1(
  Schema.Struct({
    endpoint: Schema.String,
    name: Schema.optional(Schema.NullOr(Schema.String)),
    namespace: Schema.optional(Schema.NullOr(Schema.String)),
  }),
);

const ExecutorSourcesAddOutputSchema = Schema.standardSchemaV1(Schema.Unknown);

const toExecutionId = (value: unknown) => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("Missing execution run id for executor.sources.add");
  }

  return ExecutionIdSchema.make(value);
};

const asToolPath = (value: string): ToolPath => value as ToolPath;

export const createExecutorToolMap = (input: {
  workspaceId: WorkspaceId;
  sourceAuthService: RuntimeSourceAuthService;
}): ToolMap => ({
  "executor.sources.add": toTool({
    tool: {
      description: "Add an MCP source to the current workspace, starting OAuth if the source requires it",
      inputSchema: ExecutorSourcesAddInputSchema,
      outputSchema: ExecutorSourcesAddOutputSchema,
      execute: async (
        args: {
          endpoint: string;
          name?: string | null;
          namespace?: string | null;
        },
        context,
      ): Promise<Source> => {
        const executionId = toExecutionId(context?.invocation?.runId);
        const interactionId = ExecutionInteractionIdSchema.make(
          `executor.sources.add:${crypto.randomUUID()}`,
        );
        const result = await Effect.runPromise(
          input.sourceAuthService.addExecutorMcpSource({
            workspaceId: input.workspaceId,
            executionId,
            interactionId,
            endpoint: args.endpoint,
            name: args.name ?? null,
            namespace: args.namespace ?? null,
          }),
        );

        if (result.kind === "connected") {
          return result.source;
        }

        if (!context?.onElicitation) {
          throw new Error("executor.sources.add requires an elicitation-capable host");
        }

        const response: ElicitationResponse = await Effect.runPromise(
          context.onElicitation({
            interactionId,
            path: context.path ?? asToolPath("executor.sources.add"),
            sourceKey: context.sourceKey,
            args,
            metadata: context.metadata,
            context: context.invocation,
            elicitation: {
              mode: "url",
              message: `Open the provider sign-in page to connect ${result.source.name}`,
              url: result.authorizationUrl,
              elicitationId: result.sessionId,
            },
          }),
        );

        if (response.action !== "accept") {
          throw new Error(`Source add was not completed for ${result.source.id}`);
        }

        return await Effect.runPromise(
          input.sourceAuthService.getSourceById({
            workspaceId: input.workspaceId,
            sourceId: result.source.id,
          }),
        );
      },
    },
    metadata: {
      sourceKey: "executor",
      interaction: "auto",
    },
  }),
});
