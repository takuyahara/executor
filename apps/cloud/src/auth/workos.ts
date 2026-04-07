// ---------------------------------------------------------------------------
// WorkOS AuthKit integration — sealed sessions, no server-side session store
// ---------------------------------------------------------------------------

import { WorkOS } from "@workos-inc/node";

const COOKIE_NAME = "wos-session";

let workos: WorkOS | null = null;

export const getWorkOS = (): WorkOS => {
  if (!workos) {
    workos = new WorkOS(process.env.WORKOS_API_KEY!);
  }
  return workos;
};

const getCookiePassword = (): string => {
  const password = process.env.WORKOS_COOKIE_PASSWORD;
  if (!password || password.length < 32) {
    throw new Error("WORKOS_COOKIE_PASSWORD must be at least 32 characters");
  }
  return password;
};

export const getAuthorizationUrl = (redirectUri: string): string => {
  const wos = getWorkOS();
  return wos.userManagement.getAuthorizationUrl({
    provider: "authkit",
    redirectUri,
    clientId: process.env.WORKOS_CLIENT_ID!,
  });
};

export const authenticateWithCode = async (code: string) => {
  const wos = getWorkOS();
  return wos.userManagement.authenticateWithCode({
    code,
    clientId: process.env.WORKOS_CLIENT_ID!,
    session: {
      sealSession: true,
      cookiePassword: getCookiePassword(),
    },
  });
};

/**
 * Authenticate a request using the sealed session cookie.
 * Returns user info or null if not authenticated.
 */
/**
 * Authenticate a request using the sealed session cookie.
 * Automatically refreshes expired tokens and returns a new cookie if needed.
 */
export const authenticateRequest = async (request: Request) => {
  const cookieHeader = request.headers.get("cookie");
  const sessionData = parseCookie(cookieHeader, COOKIE_NAME);
  if (!sessionData) return null;

  const wos = getWorkOS();
  const session = wos.userManagement.loadSealedSession({
    sessionData,
    cookiePassword: getCookiePassword(),
  });

  const result = await session.authenticate();

  if (result.authenticated) {
    return {
      userId: result.user.id,
      email: result.user.email,
      firstName: result.user.firstName,
      lastName: result.user.lastName,
      avatarUrl: result.user.profilePictureUrl,
      sessionId: result.sessionId,
      refreshedCookie: undefined as string | undefined,
    };
  }

  // Token expired — try refreshing
  if (result.reason === "no_session_cookie_provided") return null;

  try {
    const refreshed = await session.refresh();
    if (!refreshed.authenticated || !refreshed.sealedSession) return null;

    return {
      userId: refreshed.user.id,
      email: refreshed.user.email,
      firstName: refreshed.user.firstName,
      lastName: refreshed.user.lastName,
      avatarUrl: refreshed.user.profilePictureUrl,
      sessionId: refreshed.sessionId,
      refreshedCookie: makeSessionCookie(refreshed.sealedSession),
    };
  } catch {
    return null;
  }
};

/**
 * Get logout URL for the current session.
 */
export const getLogoutUrl = async (request: Request) => {
  const cookieHeader = request.headers.get("cookie");
  const sessionData = parseCookie(cookieHeader, COOKIE_NAME);
  if (!sessionData) return null;

  const wos = getWorkOS();
  const session = wos.userManagement.loadSealedSession({
    sessionData,
    cookiePassword: getCookiePassword(),
  });

  return session.getLogoutUrl();
};

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

export const makeSessionCookie = (sealedSession: string): string => {
  const parts = [
    `${COOKIE_NAME}=${sealedSession}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=604800", // 7 days
  ];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
};

export const clearSessionCookie = (): string =>
  `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

const parseCookie = (cookieHeader: string | null, name: string): string | null => {
  if (!cookieHeader) return null;
  const match = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${name}=`));
  if (!match) return null;
  return match.slice(name.length + 1) || null;
};
