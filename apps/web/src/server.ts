/**
 * Production server. Serves the API + Vite-built static assets.
 *
 * In development, use `bun run dev` which starts Vite with
 * @hono/vite-dev-server embedding the API via dev.ts.
 */
import { runLocalExecutorServer } from "@executor/server";

await runLocalExecutorServer({
  ui: {
    assetsDir: new URL("../dist", import.meta.url).pathname,
  },
});
