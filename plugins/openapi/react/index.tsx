import type { Source } from "@executor/react";
import {
  Result,
  defineExecutorPluginHttpApiClient,
  useAtomValue,
  useAtomSet,
  useExecutorMutation,
  useLocalInstallation,
} from "@executor/react";
import {
  openApiHttpApiExtension,
} from "@executor/plugin-openapi-http";
import type {
  OpenApiConnectInput,
  OpenApiPreviewRequest,
  OpenApiPreviewResponse,
} from "@executor/plugin-openapi-shared";
import { useNavigate } from "@tanstack/react-router";
import { startTransition, useState, type ReactNode } from "react";

type FrontendSourceTypeDefinition = {
  kind: string;
  displayName: string;
  renderAddPage: () => ReactNode;
  renderEditPage?: (input: { source: Source }) => ReactNode;
  renderDetailPage?: (input: {
    source: Source;
    route: {
      search?: unknown;
      navigate?: unknown;
    };
  }) => ReactNode;
};

type FrontendPluginRegisterApi = {
  sources: {
    registerType: (definition: FrontendSourceTypeDefinition) => void;
  };
};

const defaultOpenApiInput = (): OpenApiConnectInput => ({
  name: "My OpenAPI Source",
  specUrl: "https://example.com/openapi.json",
  baseUrl: null,
  auth: {
    kind: "none",
  },
});

const getOpenApiHttpClient = defineExecutorPluginHttpApiClient<"OpenApiReactHttpClient">()(
  "OpenApiReactHttpClient",
  [openApiHttpApiExtension] as const,
);


const Section = (props: {
  title: string;
  children: ReactNode;
}) => (
  <section className="rounded-xl border border-border/70 bg-card/40 p-4">
    <div className="mb-3 flex items-center gap-2">
      <h2 className="text-sm font-semibold">{props.title}</h2>
      <span className="inline-flex items-center rounded-full border border-transparent bg-secondary px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-secondary-foreground">
        Plugin
      </span>
    </div>
    {props.children}
  </section>
);

function OpenApiAddSourcePage(props: {
  initialValue: OpenApiConnectInput;
}) {
  const navigate = useNavigate();
  const installation = useLocalInstallation();
  const [name, setName] = useState(props.initialValue.name);
  const [specUrl, setSpecUrl] = useState(props.initialValue.specUrl);
  const [baseUrl, setBaseUrl] = useState(props.initialValue.baseUrl ?? "");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<OpenApiPreviewResponse | null>(null);
  const [nameEdited, setNameEdited] = useState(false);
  const [baseUrlEdited, setBaseUrlEdited] = useState(false);
  const openApiHttpClient = getOpenApiHttpClient();
  const secretsResult = useAtomValue(
    openApiHttpClient.query("local", "listSecrets", {
      reactivityKeys: {
        secrets: [],
      },
      timeToLive: "1 minute",
    }),
  );
  const availableSecrets = Result.isSuccess(secretsResult)
    ? secretsResult.value
    : [];
  const [authKind, setAuthKind] = useState<OpenApiConnectInput["auth"]["kind"]>(
    props.initialValue.auth.kind,
  );
  const [tokenSecretRef, setTokenSecretRef] = useState(
    props.initialValue.auth.kind === "bearer"
      ? props.initialValue.auth.tokenSecretRef
      : "",
  );
  const previewDocument = useAtomSet(
    openApiHttpClient.mutation("openapi", "previewDocument"),
    { mode: "promise" },
  );
  const createSource = useAtomSet(
    openApiHttpClient.mutation("openapi", "createSource"),
    { mode: "promise" },
  );

  const requireWorkspaceId = (): string => {
    if (installation.status === "ready") {
      return installation.data.scopeId;
    }

    if (installation.status === "error") {
      throw installation.error;
    }

    throw new Error("Workspace is still loading.");
  };

  const previewMutation = useExecutorMutation<
    OpenApiPreviewRequest,
    OpenApiPreviewResponse
  >(async (payload) =>
    previewDocument({
      path: {
        workspaceId: requireWorkspaceId() as Source["scopeId"],
      },
      payload,
    })
  );

  const createMutation = useExecutorMutation<
    OpenApiConnectInput,
    Source
  >(async (payload) =>
    createSource({
      path: {
        workspaceId: requireWorkspaceId() as Source["scopeId"],
      },
      payload,
      reactivityKeys: {
        sources: [requireWorkspaceId()],
      },
    })
  );

  const handlePreview = async () => {
    setError(null);
    const trimmedSpecUrl = specUrl.trim();
    if (!trimmedSpecUrl) {
      setError("Spec URL is required.");
      return;
    }

    if (authKind === "bearer" && tokenSecretRef.trim().length === 0) {
      setError("Select a secret for bearer auth.");
      return;
    }

    try {
      const result = await previewMutation.mutateAsync({
        specUrl: trimmedSpecUrl,
      });
      setPreview({
        ...result,
        warnings: [...result.warnings],
      });

      if (!nameEdited && result.title) {
        setName(result.title);
      }

      if (!baseUrlEdited && result.baseUrl) {
        setBaseUrl(result.baseUrl);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed previewing document.");
      setPreview(null);
    }
  };

  const handleSubmit = async () => {
    setError(null);

    const trimmedName = name.trim();
    const trimmedSpecUrl = specUrl.trim();
    const trimmedBaseUrl = baseUrl.trim();

    if (!trimmedName) {
      setError("Name is required.");
      return;
    }

    if (!trimmedSpecUrl) {
      setError("Spec URL is required.");
      return;
    }

    try {
      const source = await createMutation.mutateAsync({
        name: trimmedName,
        specUrl: trimmedSpecUrl,
        baseUrl: trimmedBaseUrl || null,
        auth:
          authKind === "bearer"
            ? {
                kind: "bearer",
                tokenSecretRef,
              }
            : {
                kind: "none",
              },
      });

      startTransition(() => {
        void navigate({
          to: "/sources/$sourceId",
          params: {
            sourceId: source.id,
          },
          search: {
            tab: "model",
          },
        });
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed creating source.");
    }
  };

  return (
    <div className="space-y-4">
      <Section title="Connection">
        <p className="text-sm text-muted-foreground">
          This plugin owns its typed HTTP client and source payload shape. The app shell only
          mounts the registered page.
        </p>
        <div className="mt-4 grid gap-4">
          <label className="grid gap-1.5">
            <span className="text-[12px] font-medium text-foreground">Name</span>
            <input
              value={name}
              onChange={(event) => {
                setNameEdited(true);
                setName(event.target.value);
              }}
              placeholder="GitHub REST"
              className="h-10 w-full rounded-lg border border-input bg-background px-3 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/35 focus:border-ring focus:ring-1 focus:ring-ring/25"
            />
          </label>

          <label className="grid gap-1.5">
            <span className="text-[12px] font-medium text-foreground">Spec URL</span>
            <input
              value={specUrl}
              onChange={(event) => setSpecUrl(event.target.value)}
              placeholder="https://example.com/openapi.json"
              className="h-10 w-full rounded-lg border border-input bg-background px-3 font-mono text-[12px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/35 focus:border-ring focus:ring-1 focus:ring-ring/25"
            />
          </label>

          <label className="grid gap-1.5">
            <span className="text-[12px] font-medium text-foreground">Base URL</span>
            <input
              value={baseUrl}
              onChange={(event) => {
                setBaseUrlEdited(true);
                setBaseUrl(event.target.value);
              }}
              placeholder="https://api.example.com"
              className="h-10 w-full rounded-lg border border-input bg-background px-3 font-mono text-[12px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/35 focus:border-ring focus:ring-1 focus:ring-ring/25"
            />
          </label>

          <label className="grid gap-1.5">
            <span className="text-[12px] font-medium text-foreground">Auth</span>
            <select
              value={authKind}
              onChange={(event) =>
                setAuthKind(event.target.value as OpenApiConnectInput["auth"]["kind"])}
              className="h-10 w-full rounded-lg border border-input bg-background px-3 text-[13px] text-foreground outline-none transition-colors focus:border-ring focus:ring-1 focus:ring-ring/25"
            >
              <option value="none">None</option>
              <option value="bearer">Bearer Secret</option>
            </select>
          </label>

          {authKind === "bearer" && (
            <label className="grid gap-1.5">
              <span className="text-[12px] font-medium text-foreground">Secret</span>
              <select
                value={tokenSecretRef}
                onChange={(event) => setTokenSecretRef(event.target.value)}
                className="h-10 w-full rounded-lg border border-input bg-background px-3 text-[13px] text-foreground outline-none transition-colors focus:border-ring focus:ring-1 focus:ring-ring/25"
              >
                <option value="">Select a secret</option>
                {availableSecrets.map((secret) => (
                  <option key={secret.id} value={secret.id}>
                    {secret.name || secret.id}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </Section>

      <Section title="Preview">
        <p className="text-sm text-muted-foreground">
          Preview introspects the document and can pull out defaults like title and base URL from
          the OpenAPI spec.
        </p>
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              void handlePreview();
            }}
            disabled={previewMutation.status === "pending" || createMutation.status === "pending"}
            className="inline-flex h-7 items-center justify-center rounded-md border border-input bg-transparent px-2.5 text-xs font-medium text-foreground disabled:pointer-events-none disabled:opacity-50"
          >
            {previewMutation.status === "pending" ? "Previewing..." : "Preview OpenAPI Document"}
          </button>
          {preview && (
            <div className="text-xs text-muted-foreground">
              {preview.operationCount} operations
              {preview.version ? ` · v${preview.version}` : ""}
            </div>
          )}
        </div>
        {preview && (
          <div className="mt-4 rounded-lg border border-border/70 bg-background/60 p-4 text-sm">
            <div className="grid gap-2">
              <div>
                <span className="font-medium text-foreground">Title:</span>{" "}
                <span className="text-muted-foreground">{preview.title ?? "Unknown"}</span>
              </div>
              <div>
                <span className="font-medium text-foreground">Version:</span>{" "}
                <span className="text-muted-foreground">{preview.version ?? "Unknown"}</span>
              </div>
              <div>
                <span className="font-medium text-foreground">Base URL:</span>{" "}
                <span className="text-muted-foreground">{preview.baseUrl ?? "Not declared"}</span>
              </div>
            </div>
            {preview.warnings.length > 0 && (
              <div className="mt-3 rounded-md border border-amber-300/40 bg-amber-100/20 px-3 py-2 text-xs text-amber-800">
                {preview.warnings.join(" ")}
              </div>
            )}
          </div>
        )}
      </Section>

      <Section title="Submit">
        <p className="text-sm text-muted-foreground">
          This plugin can use its own HTTP endpoints and the core API from one merged client. That
          is how the bearer-secret selector is loaded without a separate app-owned client path.
        </p>
        {error && (
          <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/8 px-4 py-2.5 text-[13px] text-destructive">
            {error}
          </div>
        )}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              void handleSubmit();
            }}
            disabled={createMutation.status === "pending" || installation.status === "loading"}
            className="inline-flex h-7 items-center justify-center rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground disabled:pointer-events-none disabled:opacity-50"
          >
            {createMutation.status === "pending" ? "Creating..." : "Create Source"}
          </button>
          <div className="text-xs text-muted-foreground">
            Creates a real <code>kind: &quot;openapi&quot;</code> source.
          </div>
        </div>
      </Section>
    </div>
  );
}

function OpenApiEditSourcePage(props: {
  source: Source;
}) {
  return (
    <Section title="OpenAPI Plugin Editor">
      <p className="text-sm text-muted-foreground">
        Plugin-specific configuration is stored behind the OpenAPI plugin boundary, not on the
        shared source row.
      </p>
      <pre className="mt-3 overflow-x-auto rounded-md bg-muted/60 p-3 text-xs">
        {JSON.stringify({
          id: props.source.id,
          kind: props.source.kind,
        }, null, 2)}
      </pre>
    </Section>
  );
}

function OpenApiSourceDetailPage(props: {
  source: Source;
}) {
  return (
    <div className="space-y-4">
      <Section title="Source Detail">
        <p className="text-sm text-muted-foreground">
          OpenAPI-specific configuration and auth live in plugin storage. The shared source record
          only carries generic routing and status metadata.
        </p>
        <pre className="mt-3 overflow-x-auto rounded-md bg-muted/60 p-3 text-xs">
          {JSON.stringify({
            id: props.source.id,
            name: props.source.name,
            kind: props.source.kind,
            status: props.source.status,
          }, null, 2)}
        </pre>
      </Section>

      <Section title="Plugin Boundary">
        <p className="text-sm text-muted-foreground">
          The shell only knows there is a registered source plugin named <code>openapi</code>.
          Everything specific stays inside this plugin.
        </p>
      </Section>
    </div>
  );
}

export const OpenApiReactPlugin = {
  key: "openapi",
  register(api: FrontendPluginRegisterApi) {
    api.sources.registerType({
      kind: "openapi",
      displayName: "OpenAPI",
      renderAddPage: () => (
        <OpenApiAddSourcePage initialValue={defaultOpenApiInput()} />
      ),
      renderEditPage: ({ source }) => (
        <OpenApiEditSourcePage source={source} />
      ),
      renderDetailPage: ({ source }) => (
        <OpenApiSourceDetailPage source={source} />
      ),
    });
  },
};
