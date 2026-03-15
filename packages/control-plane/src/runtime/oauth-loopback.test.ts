import { createServer } from "node:http";

import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { startOauthLoopbackRedirectServer } from "./oauth-loopback";

const withCompletionServer = async <T>(handler: (input: {
  completionUrl: string;
  requests: string[];
}) => Promise<T>): Promise<T> => {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(request.url ?? "/");
    response.statusCode = 200;
    response.end("ok");
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", (error?: Error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  try {
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to resolve completion server address");
    }

    return await handler({
      completionUrl: `http://127.0.0.1:${address.port}/oauth/complete?sessionId=test-session`,
      requests,
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
};

describe("oauth-loopback", () => {
  it("redirects loopback callbacks to the app completion URL with query params intact", async () => {
    await withCompletionServer(async ({ completionUrl, requests }) => {
      const receiver = await Effect.runPromise(
        startOauthLoopbackRedirectServer({
          completionUrl,
        }),
      );

      const response = await fetch(
        `${receiver.redirectUri}?state=oauth-state&code=oauth-code`,
        {
          redirect: "follow",
          signal: AbortSignal.timeout(10_000),
        },
      );

      expect(response.ok).toBe(true);
      expect(requests).toEqual([
        "/oauth/complete?sessionId=test-session&state=oauth-state&code=oauth-code",
      ]);

      await Effect.runPromise(receiver.close);
    });
  });
});
