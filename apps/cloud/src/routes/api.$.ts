import { createFileRoute } from "@tanstack/react-router";

const handle = async (request: Request) => {
  const { handleApiRequest } = await import("../server/api-handler");
  return handleApiRequest(request);
};

export const Route = createFileRoute("/api/$")({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
      POST: ({ request }) => handle(request),
      PUT: ({ request }) => handle(request),
      DELETE: ({ request }) => handle(request),
      PATCH: ({ request }) => handle(request),
    },
  },
});
