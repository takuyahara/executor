// ---------------------------------------------------------------------------
// Cloud API — reuses @executor/server's composed API layer
// ---------------------------------------------------------------------------

import {
  HttpApiBuilder,
  HttpMiddleware,
  HttpServer,
} from "@effect/platform";
import { Effect, Layer } from "effect";

import { createExecutionEngine } from "@executor/execution";
import { makeUserStore } from "@executor/storage-postgres";
import {
  ApiLayer,
  ExecutorService,
  ExecutionEngineService,
} from "@executor/server";

import { createTeamExecutor } from "./services/executor";
import { parseSessionId, validateSession } from "./auth/session";
import type { DrizzleDb } from "./services/db";

// ---------------------------------------------------------------------------
// Create API handler with auth-based executor resolution
// ---------------------------------------------------------------------------

export const createCloudApiHandler = (db: DrizzleDb, encryptionKey: string) => {
  const userStore = makeUserStore(db);

  return async (request: Request): Promise<Response> => {
    // Resolve auth from cookie
    const sessionId = parseSessionId(request.headers.get("cookie"));
    if (!sessionId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const session = await validateSession(userStore, sessionId);
    if (!session) {
      return Response.json({ error: "Invalid session" }, { status: 401 });
    }

    const user = await userStore.getUser(session.userId);
    if (!user) {
      return Response.json({ error: "User not found" }, { status: 401 });
    }

    const team = await userStore.getTeam(session.teamId);
    const teamName = team?.name ?? "Unknown Team";

    // Create per-request executor
    const executor = await Effect.runPromise(
      createTeamExecutor(db, session.teamId, teamName, encryptionKey),
    );

    const engine = createExecutionEngine({ executor });

    const handler = HttpApiBuilder.toWebHandler(
      ApiLayer.pipe(
        Layer.provideMerge(Layer.succeed(ExecutorService, executor)),
        Layer.provideMerge(Layer.succeed(ExecutionEngineService, engine)),
        Layer.provideMerge(HttpServer.layerContext),
      ),
      { middleware: HttpMiddleware.logger },
    );

    try {
      return await handler.handler(request);
    } finally {
      await Effect.runPromise(executor.close()).catch(() => undefined);
      handler.dispose();
    }
  };
};
