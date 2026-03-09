import type { Source } from "@executor-v3/react";

export type SourceTemplate = {
  id: string;
  name: string;
  summary: string;
  kind: Source["kind"];
  endpoint: string;
};

export const sourceTemplates: ReadonlyArray<SourceTemplate> = [
  {
    id: "deepwiki-mcp",
    name: "DeepWiki MCP",
    summary: "Repository docs and knowledge graphs via MCP.",
    kind: "mcp",
    endpoint: "https://mcp.deepwiki.com/mcp",
  },
  {
    id: "axiom-mcp",
    name: "Axiom MCP",
    summary: "Query, stream, and analyze logs, traces, and event data.",
    kind: "mcp",
    endpoint: "https://mcp.axiom.co/mcp",
  },
  {
    id: "github-rest",
    name: "GitHub REST API",
    summary: "Repos, issues, pull requests, actions, and org settings.",
    kind: "openapi",
    endpoint: "https://api.github.com",
  },
  {
    id: "github-graphql",
    name: "GitHub GraphQL",
    summary: "Issues, pull requests, discussions, and repository objects via GraphQL.",
    kind: "graphql",
    endpoint: "https://api.github.com/graphql",
  },
  {
    id: "gitlab-graphql",
    name: "GitLab GraphQL",
    summary: "Projects, merge requests, issues, CI pipelines, and users.",
    kind: "graphql",
    endpoint: "https://gitlab.com/api/graphql",
  },
  {
    id: "openai-api",
    name: "OpenAI API",
    summary: "Models, files, responses, and fine-tuning.",
    kind: "openapi",
    endpoint: "https://api.openai.com/v1",
  },
  {
    id: "vercel-api",
    name: "Vercel API",
    summary: "Deployments, projects, domains, and environments.",
    kind: "openapi",
    endpoint: "https://api.vercel.com",
  },
  {
    id: "stripe-api",
    name: "Stripe API",
    summary: "Payments, billing, subscriptions, and invoices.",
    kind: "openapi",
    endpoint: "https://api.stripe.com",
  },
  {
    id: "linear-graphql",
    name: "Linear GraphQL",
    summary: "Issues, teams, cycles, and projects.",
    kind: "graphql",
    endpoint: "https://api.linear.app/graphql",
  },
  {
    id: "monday-graphql",
    name: "Monday GraphQL",
    summary: "Boards, items, updates, users, and workspace metadata.",
    kind: "graphql",
    endpoint: "https://api.monday.com/v2",
  },
  {
    id: "anilist-graphql",
    name: "AniList GraphQL",
    summary: "Anime, manga, characters, media lists, and recommendations.",
    kind: "graphql",
    endpoint: "https://graphql.anilist.co",
  },
];
