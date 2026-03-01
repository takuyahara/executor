/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as controlPlane from "../controlPlane.js";
import type * as control_plane_actor from "../control_plane/actor.js";
import type * as control_plane_approvals from "../control_plane/approvals.js";
import type * as control_plane_credentials from "../control_plane/credentials.js";
import type * as control_plane_errors from "../control_plane/errors.js";
import type * as control_plane_graphql_ingest_support from "../control_plane/graphql_ingest_support.js";
import type * as control_plane_http from "../control_plane/http.js";
import type * as control_plane_mcp_ingest_support from "../control_plane/mcp_ingest_support.js";
import type * as control_plane_openapi_ingest from "../control_plane/openapi_ingest.js";
import type * as control_plane_openapi_ingest_mvp from "../control_plane/openapi_ingest_mvp.js";
import type * as control_plane_organizations from "../control_plane/organizations.js";
import type * as control_plane_policies from "../control_plane/policies.js";
import type * as control_plane_service from "../control_plane/service.js";
import type * as control_plane_sources from "../control_plane/sources.js";
import type * as control_plane_storage from "../control_plane/storage.js";
import type * as control_plane_tools from "../control_plane/tools.js";
import type * as control_plane_workspaces from "../control_plane/workspaces.js";
import type * as credential_resolver from "../credential_resolver.js";
import type * as executor from "../executor.js";
import type * as http from "../http.js";
import type * as mcp from "../mcp.js";
import type * as run_executor from "../run_executor.js";
import type * as runtimeCallbacks from "../runtimeCallbacks.js";
import type * as runtime_adapter from "../runtime_adapter.js";
import type * as runtime_execution_port from "../runtime_execution_port.js";
import type * as source_tool_registry from "../source_tool_registry.js";
import type * as task_runs from "../task_runs.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  controlPlane: typeof controlPlane;
  "control_plane/actor": typeof control_plane_actor;
  "control_plane/approvals": typeof control_plane_approvals;
  "control_plane/credentials": typeof control_plane_credentials;
  "control_plane/errors": typeof control_plane_errors;
  "control_plane/graphql_ingest_support": typeof control_plane_graphql_ingest_support;
  "control_plane/http": typeof control_plane_http;
  "control_plane/mcp_ingest_support": typeof control_plane_mcp_ingest_support;
  "control_plane/openapi_ingest": typeof control_plane_openapi_ingest;
  "control_plane/openapi_ingest_mvp": typeof control_plane_openapi_ingest_mvp;
  "control_plane/organizations": typeof control_plane_organizations;
  "control_plane/policies": typeof control_plane_policies;
  "control_plane/service": typeof control_plane_service;
  "control_plane/sources": typeof control_plane_sources;
  "control_plane/storage": typeof control_plane_storage;
  "control_plane/tools": typeof control_plane_tools;
  "control_plane/workspaces": typeof control_plane_workspaces;
  credential_resolver: typeof credential_resolver;
  executor: typeof executor;
  http: typeof http;
  mcp: typeof mcp;
  run_executor: typeof run_executor;
  runtimeCallbacks: typeof runtimeCallbacks;
  runtime_adapter: typeof runtime_adapter;
  runtime_execution_port: typeof runtime_execution_port;
  source_tool_registry: typeof source_tool_registry;
  task_runs: typeof task_runs;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
