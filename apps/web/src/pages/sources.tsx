import { useState, Suspense, useMemo } from "react";
import { Result, useAtomValue, useAtomRefresh, toolsAtom } from "@executor/react";
import type { SourcePlugin } from "@executor/react";
import { openApiSourcePlugin } from "@executor/plugin-openapi/react";

// ---------------------------------------------------------------------------
// Registered source plugins
// ---------------------------------------------------------------------------

const sourcePlugins: SourcePlugin[] = [openApiSourcePlugin];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function SourcesPage() {
  const [adding, setAdding] = useState<string | null>(null);
  const tools = useAtomValue(toolsAtom());
  const refreshTools = useAtomRefresh(toolsAtom());

  // Group tools by namespace (second tag after "openapi")
  const sources = useMemo(() => {
    if (tools._tag !== "Success") return [];
    const namespaces = new Map<string, number>();
    for (const tool of tools.value) {
      // Tools are tagged ["openapi", namespace, ...]
      const ns = tool.tags.find(
        (t) => t !== "openapi" && !sourcePlugins.some((p) => p.key === t),
      );
      if (ns) {
        namespaces.set(ns, (namespaces.get(ns) ?? 0) + 1);
      }
    }
    return [...namespaces.entries()].map(([namespace, toolCount]) => ({
      namespace,
      toolCount,
    }));
  }, [tools]);

  const plugin = adding
    ? sourcePlugins.find((p) => p.key === adding)
    : undefined;

  if (plugin) {
    const AddComponent = plugin.add;
    return (
      <Suspense fallback={<p>Loading…</p>}>
        <AddComponent
          onComplete={() => {
            setAdding(null);
            refreshTools();
          }}
          onCancel={() => setAdding(null)}
        />
      </Suspense>
    );
  }

  return (
    <div>
      <h2>Sources</h2>

      {Result.match(tools, {
        onInitial: () => <p>Loading…</p>,
        onFailure: () => <p style={{ color: "red" }}>Failed to load sources</p>,
        onSuccess: () =>
          sources.length === 0 ? (
            <p style={{ color: "#888" }}>No sources configured yet.</p>
          ) : (
            <ul>
              {sources.map((s) => (
                <li key={s.namespace}>
                  <strong>{s.namespace}</strong> — {s.toolCount} tools
                </li>
              ))}
            </ul>
          ),
      })}

      <div style={{ marginTop: "1rem" }}>
        <h3>Add a source</h3>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {sourcePlugins.map((p) => (
            <button key={p.key} onClick={() => setAdding(p.key)}>
              {p.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
