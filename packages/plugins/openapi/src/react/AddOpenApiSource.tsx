import { useState, useMemo, createContext, useContext } from "react";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { useAtomSet, Result } from "@effect-atom/atom-react";
import { Option } from "effect";

import { previewOpenApiSpec, addOpenApiSpec } from "./atoms";
import type { SpecPreview } from "../sdk/preview";

// ---------------------------------------------------------------------------
// Shared state via context
// ---------------------------------------------------------------------------

type Navigate = (to: string) => void;
const NavContext = createContext<Navigate>(() => {});
const useNav = () => useContext(NavContext);

interface AddState {
  specUrl: string;
  setSpecUrl: (v: string) => void;
  preview: Result.Result<SpecPreview, unknown> | null;
  doPreview: (spec: string) => void;
  doAdd: (spec: string, baseUrl?: string, headers?: Record<string, unknown>) => void;
  onComplete: () => void;
  onCancel: () => void;
}

const AddStateContext = createContext<AddState>(null!);
const useAddState = () => useContext(AddStateContext);

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

function UrlStep() {
  const { specUrl, setSpecUrl, onCancel, doPreview } = useAddState();
  const nav = useNav();

  const handleNext = () => {
    doPreview(specUrl);
    nav("/auth");
  };

  return (
    <div>
      <label>
        Spec URL or paste JSON/YAML:
        <textarea
          value={specUrl}
          onChange={(e) => setSpecUrl((e.target as HTMLTextAreaElement).value)}
          placeholder={'https://api.example.com/openapi.json\n\nor paste spec content here...'}
          rows={6}
          style={{ width: "100%", fontFamily: "monospace", fontSize: "0.85rem" }}
        />
      </label>
      <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.5rem" }}>
        <button onClick={onCancel}>Cancel</button>
        <button disabled={!specUrl.trim()} onClick={handleNext}>
          Next
        </button>
      </div>
    </div>
  );
}

function AuthStep() {
  const { preview } = useAddState();
  const nav = useNav();

  return (
    <div>
      {preview && Result.match(preview, {
        onInitial: () => <p>Analyzing spec…</p>,
        onSuccess: ({ value }) => (
          <div>
            <h4>{Option.getOrElse(value.title, () => "API")} {Option.getOrElse(value.version, () => "")}</h4>
            <p>{value.operationCount} operations found</p>
            {value.headerPresets.length > 0 && (
              <div>
                <p>Authentication options:</p>
                <ul>
                  {value.headerPresets.map((p, i) => (
                    <li key={i}>{p.label}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ),
        onFailure: () => <p style={{ color: "red" }}>Failed to parse spec</p>,
      })}
      <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.5rem" }}>
        <button onClick={() => nav("/")}>Back</button>
        <button onClick={() => nav("/confirm")}>Next</button>
      </div>
    </div>
  );
}

function ConfirmStep() {
  const { specUrl, doAdd, onComplete } = useAddState();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nav = useNav();

  const handleAdd = async () => {
    setAdding(true);
    setError(null);
    try {
      doAdd(specUrl);
      onComplete();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setAdding(false);
    }
  };

  return (
    <div>
      <p>Ready to add spec.</p>
      {error && <p style={{ color: "red" }}>{error}</p>}
      <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.5rem" }}>
        <button onClick={() => nav("/auth")} disabled={adding}>Back</button>
        <button onClick={handleAdd} disabled={adding}>
          {adding ? "Adding…" : "Add Source"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AddOpenApiSource(props: {
  onComplete: () => void;
  onCancel: () => void;
}) {
  const [specUrl, setSpecUrl] = useState("");
  const [preview] = useState<Result.Result<SpecPreview, unknown> | null>(null);

  const doPreviewMutation = useAtomSet(previewOpenApiSpec, { mode: "promise" });
  const doAddMutation = useAtomSet(addOpenApiSpec, { mode: "promise" });

  const router = useMemo(() => {
    const rootRoute = createRootRoute({
      component: () => (
        <div>
          <h3>Add OpenAPI Source</h3>
          <Outlet />
        </div>
      ),
    });

    const routeTree = rootRoute.addChildren([
      createRoute({ getParentRoute: () => rootRoute, path: "/", component: UrlStep }),
      createRoute({ getParentRoute: () => rootRoute, path: "/auth", component: AuthStep }),
      createRoute({ getParentRoute: () => rootRoute, path: "/confirm", component: ConfirmStep }),
    ]);

    return createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
  }, []);

  const navigate: Navigate = (to) => {
    void router.navigate({ to });
  };

  const state: AddState = {
    specUrl,
    setSpecUrl,
    preview,
    doPreview: (spec) => {
      void doPreviewMutation({ path: { scopeId: "default" as never }, payload: { spec } });
    },
    doAdd: (spec, baseUrl, headers) => {
      void doAddMutation({
        path: { scopeId: "default" as never },
        payload: { spec, baseUrl, headers },
      });
    },
    onComplete: props.onComplete,
    onCancel: props.onCancel,
  };

  return (
    <AddStateContext.Provider value={state}>
      <NavContext.Provider value={navigate}>
        <RouterProvider router={router} />
      </NavContext.Provider>
    </AddStateContext.Provider>
  );
}
