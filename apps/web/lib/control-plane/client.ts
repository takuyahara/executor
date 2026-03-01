import { createControlPlaneAtomClient } from "@executor-v2/management-api/client";
import { ControlPlaneAuthHeaders } from "@executor-v2/management-api/auth/principal";

const trim = (value: string | undefined): string | undefined => {
  const candidate = value?.trim();
  return candidate && candidate.length > 0 ? candidate : undefined;
};

const browserAccountIdKey = "__EXECUTOR_ACCOUNT_ID__";

type ExecutorWindow = Window & {
  [browserAccountIdKey]?: string;
};

const defaultControlPlaneBaseUrl = "http://127.0.0.1:8788";

const controlPlaneBaseUrl =
  typeof window === "undefined"
    ? trim(process.env.CONTROL_PLANE_SERVER_BASE_URL)
      ?? trim(process.env.CONTROL_PLANE_UPSTREAM_URL)
      ?? trim(process.env.NEXT_PUBLIC_CONTROL_PLANE_BASE_URL)
      ?? trim(process.env.NEXT_PUBLIC_CONVEX_URL)
      ?? trim(process.env.CONVEX_URL)
      ?? defaultControlPlaneBaseUrl
    : trim(process.env.NEXT_PUBLIC_CONTROL_PLANE_BASE_URL)
      ?? trim(process.env.NEXT_PUBLIC_CONVEX_URL)
      ?? defaultControlPlaneBaseUrl;

const configuredControlPlaneAccountId = trim(process.env.NEXT_PUBLIC_CONTROL_PLANE_ACCOUNT_ID);

const resolveControlPlaneAccountId = (): string | undefined => {
  if (configuredControlPlaneAccountId) {
    return configuredControlPlaneAccountId;
  }

  if (typeof window !== "undefined") {
    const browserAccountId = trim((window as ExecutorWindow)[browserAccountIdKey]);
    if (browserAccountId) {
      return browserAccountId;
    }
  }

  return undefined;
};

export const controlPlaneClient = createControlPlaneAtomClient({
  baseUrl: controlPlaneBaseUrl,
  headers: () => {
    const accountId = resolveControlPlaneAccountId();
    return accountId
      ? {
          [ControlPlaneAuthHeaders.accountId]: accountId,
        }
      : undefined;
  },
});
