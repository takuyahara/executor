import { handleApiRequest as _handleApiRequest } from "../api";

export const handleApiRequest = (request: Request) => {
  // Strip /api prefix — route catch-all (api.$.ts) matches /api/*
  // but Effect endpoints are defined without the prefix
  const url = new URL(request.url);
  url.pathname = url.pathname.replace(/^\/api/, "");
  return _handleApiRequest(new Request(url, request));
};
