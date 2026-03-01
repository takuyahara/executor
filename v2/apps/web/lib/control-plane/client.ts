import { createControlPlaneAtomClient } from "@executor-v2/management-api/client";
import { ControlPlaneAuthHeaders } from "@executor-v2/management-api/auth/principal";

const controlPlaneBaseUrl =
  typeof window === "undefined"
    ? process.env.CONTROL_PLANE_SERVER_BASE_URL ??
      process.env.NEXT_PUBLIC_CONTROL_PLANE_BASE_URL ??
      "http://127.0.0.1:4312/api/control-plane"
    : process.env.NEXT_PUBLIC_CONTROL_PLANE_BASE_URL ?? "/api/control-plane";

const controlPlaneAccountId = process.env.NEXT_PUBLIC_CONTROL_PLANE_ACCOUNT_ID;

const controlPlaneHeaders =
  controlPlaneAccountId === undefined || controlPlaneAccountId.trim().length === 0
    ? undefined
    : {
        [ControlPlaneAuthHeaders.accountId]: controlPlaneAccountId,
      };

export const controlPlaneClient = createControlPlaneAtomClient({
  baseUrl: controlPlaneBaseUrl,
  headers: controlPlaneHeaders,
});
