import { HttpApi, OpenApi } from "@effect/platform";

import { ExecutionsApi } from "./executions/api";
import { LocalApi } from "./local/api";
import { MembershipsApi } from "./memberships/api";
import { OAuthApi } from "./oauth/api";
import { OrganizationsApi } from "./organizations/api";
import { PoliciesApi } from "./policies/api";
import { SourcesApi } from "./sources/api";
import { WorkspacesApi } from "./workspaces/api";

export class ControlPlaneApi extends HttpApi.make("controlPlane")
  .add(LocalApi)
  .add(OAuthApi)
  .add(OrganizationsApi)
  .add(MembershipsApi)
  .add(WorkspacesApi)
  .add(SourcesApi)
  .add(PoliciesApi)
  .add(ExecutionsApi)
  .annotateContext(
    OpenApi.annotations({
      title: "Executor Control Plane API",
      description: "CRUD control plane for organizations, workspaces, sources, and policies",
    }),
  ) {}

export const controlPlaneOpenApiSpec = OpenApi.fromApi(ControlPlaneApi);
