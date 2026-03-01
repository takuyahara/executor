import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "@effect/platform";
import {
  OpenApiHttpMethodSchema,
  SourceIdSchema,
  SourceKindSchema,
  WorkspaceIdSchema,
} from "@executor-v2/schema";
import * as Schema from "effect/Schema";

import {
  ControlPlaneBadRequestError,
  ControlPlaneForbiddenError,
  ControlPlaneStorageError,
  ControlPlaneUnauthorizedError,
} from "../errors";

export const SourceToolSummarySchema = Schema.Struct({
  sourceId: SourceIdSchema,
  sourceName: Schema.String,
  sourceKind: SourceKindSchema,
  toolId: Schema.String,
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  method: OpenApiHttpMethodSchema,
  path: Schema.String,
  operationHash: Schema.String,
});

export type SourceToolSummary = typeof SourceToolSummarySchema.Type;

const workspaceIdParam = HttpApiSchema.param("workspaceId", WorkspaceIdSchema);
const sourceIdParam = HttpApiSchema.param("sourceId", SourceIdSchema);

export class ToolsApi extends HttpApiGroup.make("tools")
  .add(
    HttpApiEndpoint.get("listWorkspaceTools")`/workspaces/${workspaceIdParam}/tools`
      .addSuccess(Schema.Array(SourceToolSummarySchema))
      .addError(ControlPlaneBadRequestError)
      .addError(ControlPlaneUnauthorizedError)
      .addError(ControlPlaneForbiddenError)
      .addError(ControlPlaneStorageError),
  )
  .add(
    HttpApiEndpoint.get(
      "listSourceTools",
    )`/workspaces/${workspaceIdParam}/sources/${sourceIdParam}/tools`
      .addSuccess(Schema.Array(SourceToolSummarySchema))
      .addError(ControlPlaneBadRequestError)
      .addError(ControlPlaneUnauthorizedError)
      .addError(ControlPlaneForbiddenError)
      .addError(ControlPlaneStorageError),
  )
  .prefix("/v1") {}
