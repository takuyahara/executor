import { useState } from "react";
import { useAtomSet, useAtomValue, useAtomRefresh, Result } from "@effect-atom/atom-react";
import { Option } from "effect";

import { secretsAtom, setSecret, ScopeId } from "@executor/react";
import { SecretId } from "@executor/sdk";
import { Button } from "@executor/ui/components/button";
import { Input } from "@executor/ui/components/input";
import { Label } from "@executor/ui/components/label";
import { Textarea } from "@executor/ui/components/textarea";
import { Badge } from "@executor/ui/components/badge";
import { NativeSelect, NativeSelectOption } from "@executor/ui/components/native-select";
import { RadioGroup, RadioGroupItem } from "@executor/ui/components/radio-group";
import { Separator } from "@executor/ui/components/separator";
import { Spinner } from "@executor/ui/components/spinner";
import { previewOpenApiSpec, addOpenApiSpec } from "./atoms";
import type { SpecPreview, HeaderPreset } from "../sdk/preview";
import type { HeaderValue } from "../sdk/types";

// ---------------------------------------------------------------------------
// Inline secret creation
// ---------------------------------------------------------------------------

function InlineCreateSecret(props: {
  headerName: string;
  suggestedId: string;
  onCreated: (secretId: string) => void;
  onCancel: () => void;
}) {
  const [secretId, setSecretId] = useState(props.suggestedId);
  const [secretName, setSecretName] = useState(props.headerName);
  const [secretValue, setSecretValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const doSet = useAtomSet(setSecret, { mode: "promise" });
  const refreshSecrets = useAtomRefresh(secretsAtom());

  const handleSave = async () => {
    if (!secretId.trim() || !secretValue.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await doSet({
        path: { scopeId: ScopeId.make("default") },
        payload: {
          id: SecretId.make(secretId.trim()),
          name: secretName.trim() || secretId.trim(),
          value: secretValue.trim(),
          purpose: `Auth header: ${props.headerName}`,
        },
      });
      refreshSecrets();
      props.onCreated(secretId.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save secret");
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-primary/20 bg-primary/[0.02] p-3 space-y-2.5">
      <p className="text-[11px] font-semibold text-primary tracking-wide uppercase">New secret</p>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">ID</Label>
          <Input
            value={secretId}
            onChange={(e) => setSecretId((e.target as HTMLInputElement).value)}
            placeholder="my-api-token"
            className="h-8 text-xs font-mono"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Label</Label>
          <Input
            value={secretName}
            onChange={(e) => setSecretName((e.target as HTMLInputElement).value)}
            placeholder="API Token"
            className="h-8 text-xs"
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Value</Label>
        <Input
          type="password"
          value={secretValue}
          onChange={(e) => setSecretValue((e.target as HTMLInputElement).value)}
          placeholder="paste your token or key…"
          className="h-8 text-xs font-mono"
        />
      </div>
      {error && <p className="text-[11px] text-destructive">{error}</p>}
      <div className="flex gap-1.5 pt-0.5">
        <Button variant="outline" size="xs" onClick={props.onCancel}>
          Cancel
        </Button>
        <Button
          size="xs"
          onClick={handleSave}
          disabled={!secretId.trim() || !secretValue.trim() || saving}
        >
          {saving ? "Saving…" : "Create & use"}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header secret row — pick existing or create inline
// ---------------------------------------------------------------------------

function HeaderSecretRow(props: {
  headerName: string;
  prefix?: string;
  selectedSecretId: string | null;
  onSelect: (secretId: string) => void;
  existingSecrets: readonly { id: string; name: string }[];
}) {
  const [creating, setCreating] = useState(false);
  const { headerName, prefix, selectedSecretId, onSelect, existingSecrets } = props;
  const suggestedId = headerName.toLowerCase().replace(/[^a-z0-9]+/g, "-");

  if (creating) {
    return (
      <InlineCreateSecret
        headerName={headerName}
        suggestedId={suggestedId}
        onCreated={(id) => {
          onSelect(id);
          setCreating(false);
        }}
        onCancel={() => setCreating(false)}
      />
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-foreground">{headerName}</span>
          {prefix && (
            <Badge variant="secondary" className="text-[10px] font-mono px-1.5 py-0">
              {prefix.trim()}…
            </Badge>
          )}
        </div>
        {selectedSecretId && (
          <Badge variant="outline" className="text-[10px] text-emerald-600 dark:text-emerald-400 border-emerald-500/20 bg-emerald-500/10">
            ✓ {selectedSecretId}
          </Badge>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <NativeSelect
          value={selectedSecretId ?? ""}
          onChange={(e) => {
            const v = (e.target as HTMLSelectElement).value;
            if (v) onSelect(v);
          }}
          className="flex-1 w-full text-xs"
        >
          <NativeSelectOption value="" disabled>
            {existingSecrets.length === 0 ? "No secrets yet — create one →" : "Select a secret…"}
          </NativeSelectOption>
          {existingSecrets.map((s) => (
            <NativeSelectOption key={s.id} value={s.id}>
              {s.name} ({s.id})
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
          + New
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Custom header row — user-defined header name + secret
// ---------------------------------------------------------------------------

function CustomHeaderRow(props: {
  name: string;
  secretId: string | null;
  onChangeName: (name: string) => void;
  onSelectSecret: (secretId: string) => void;
  onRemove: () => void;
  existingSecrets: readonly { id: string; name: string }[];
}) {
  const [creating, setCreating] = useState(false);
  const { name, secretId, onChangeName, onSelectSecret, onRemove, existingSecrets } = props;
  const suggestedId = name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "custom-header";

  if (creating) {
    return (
      <InlineCreateSecret
        headerName={name || "Custom Header"}
        suggestedId={suggestedId}
        onCreated={(id) => {
          onSelectSecret(id);
          setCreating(false);
        }}
        onCancel={() => setCreating(false)}
      />
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Header name</Label>
        <Button variant="ghost" size="xs" className="text-muted-foreground hover:text-destructive" onClick={onRemove}>
          Remove
        </Button>
      </div>
      <Input
        value={name}
        onChange={(e) => onChangeName((e.target as HTMLInputElement).value)}
        placeholder="Authorization"
        className="h-8 text-xs font-mono"
      />
      <div className="flex items-center gap-1.5">
        <NativeSelect
          value={secretId ?? ""}
          onChange={(e) => {
            const v = (e.target as HTMLSelectElement).value;
            if (v) onSelectSecret(v);
          }}
          className="flex-1 w-full text-xs"
        >
          <NativeSelectOption value="" disabled>
            {existingSecrets.length === 0 ? "No secrets yet — create one →" : "Select a secret…"}
          </NativeSelectOption>
          {existingSecrets.map((s) => (
            <NativeSelectOption key={s.id} value={s.id}>
              {s.name} ({s.id})
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
          + New
        </Button>
      </div>
      {secretId && (
        <Badge variant="outline" className="text-[10px] text-emerald-600 dark:text-emerald-400 border-emerald-500/20 bg-emerald-500/10">
          ✓ {secretId}
        </Badge>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function prefixForHeader(preset: HeaderPreset, headerName: string): string | undefined {
  const label = preset.label.toLowerCase();
  if (headerName.toLowerCase() === "authorization") {
    if (label.includes("bearer")) return "Bearer ";
    if (label.includes("basic")) return "Basic ";
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Main component — single progressive form
// ---------------------------------------------------------------------------

export default function AddOpenApiSource(props: {
  onComplete: () => void;
  onCancel: () => void;
}) {
  // Spec input
  const [specUrl, setSpecUrl] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  // After analysis
  const [preview, setPreview] = useState<SpecPreview | null>(null);
  const [baseUrl, setBaseUrl] = useState("");

  // Auth
  const [presetIndex, setPresetIndex] = useState(0);
  const [headers, setHeaders] = useState<Record<string, HeaderValue>>({});
  const [customHeaders, setCustomHeaders] = useState<Array<{ name: string; secretId: string | null }>>([]);

  // Submit
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const doPreview = useAtomSet(previewOpenApiSpec, { mode: "promise" });
  const doAdd = useAtomSet(addOpenApiSpec, { mode: "promise" });
  const secrets = useAtomValue(secretsAtom());

  const secretList: readonly { id: string; name: string }[] = Result.match(secrets, {
    onInitial: () => [] as { id: string; name: string }[],
    onFailure: () => [] as { id: string; name: string }[],
    onSuccess: ({ value }) => value.map((s) => ({ id: s.id, name: s.name })),
  });

  // ---- Derived state ----

  const presets = preview?.headerPresets ?? [];
  const hasAuth = presets.length > 0;
  const servers = (preview?.servers ?? []) as Array<{ url?: string }>;
  const selectedPreset = presetIndex >= 0 ? presets[presetIndex] ?? null : null;

  const allSecretsFilled =
    !selectedPreset ||
    selectedPreset.secretHeaders.length === 0 ||
    selectedPreset.secretHeaders.every(
      (h) => headers[h] && typeof headers[h] !== "string",
    );

  // Merge preset headers + custom headers into final map
  const allHeaders: Record<string, HeaderValue> = { ...headers };
  for (const ch of customHeaders) {
    if (ch.name.trim() && ch.secretId) {
      allHeaders[ch.name.trim()] = { secretId: ch.secretId };
    }
  }
  const hasHeaders = Object.keys(allHeaders).length > 0;

  const customHeadersValid = customHeaders.every(
    (ch) => ch.name.trim() && ch.secretId,
  );

  const canAdd =
    preview !== null &&
    baseUrl.trim().length > 0 &&
    (!hasAuth || presetIndex === -1 || allSecretsFilled) &&
    (customHeaders.length === 0 || customHeadersValid);

  // ---- Handlers ----

  const handleAnalyze = async () => {
    setAnalyzing(true);
    setAnalyzeError(null);
    setAddError(null);
    try {
      const result = await doPreview({
        path: { scopeId: "default" as never },
        payload: { spec: specUrl },
      });
      setPreview(result);

      const firstUrl = (result.servers as Array<{ url?: string }>)?.[0]?.url;
      if (firstUrl) setBaseUrl(firstUrl);

      setPresetIndex(result.headerPresets.length > 0 ? 0 : -1);
      setHeaders({});
      setCustomHeaders([]);
    } catch (e) {
      setAnalyzeError(e instanceof Error ? e.message : "Failed to parse spec");
    } finally {
      setAnalyzing(false);
    }
  };

  const selectPreset = (index: number) => {
    setPresetIndex(index);
    setHeaders({});
  };

  const setSecretForHeader = (headerName: string, secretId: string) => {
    if (!selectedPreset) return;
    const prefix = prefixForHeader(selectedPreset, headerName);
    setHeaders({
      ...headers,
      [headerName]: { secretId, ...(prefix ? { prefix } : {}) },
    });
  };

  const addCustomHeader = () => {
    setCustomHeaders([...customHeaders, { name: "", secretId: null }]);
  };

  const updateCustomHeader = (index: number, update: Partial<{ name: string; secretId: string | null }>) => {
    setCustomHeaders(customHeaders.map((ch, i) => (i === index ? { ...ch, ...update } : ch)));
  };

  const removeCustomHeader = (index: number) => {
    setCustomHeaders(customHeaders.filter((_, i) => i !== index));
  };

  const handleAdd = async () => {
    setAdding(true);
    setAddError(null);
    try {
      await doAdd({
        path: { scopeId: "default" as never },
        payload: {
          spec: specUrl,
          baseUrl: baseUrl.trim() || undefined,
          ...(hasHeaders ? { headers: allHeaders } : {}),
        },
      });
      props.onComplete();
    } catch (e) {
      setAddError(e instanceof Error ? e.message : "Failed to add source");
      setAdding(false);
    }
  };

  // ---- Render ----

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-foreground">Add OpenAPI Source</h1>

      {/* ── Spec input ── */}
      <section className="space-y-2">
        <Label>OpenAPI Spec</Label>
        <Textarea
          value={specUrl}
          onChange={(e) => {
            setSpecUrl((e.target as HTMLTextAreaElement).value);
            if (preview) {
              setPreview(null);
              setBaseUrl("");
              setHeaders({});
              setCustomHeaders([]);
            }
          }}
          placeholder="https://api.example.com/openapi.json"
          rows={3}
          className="font-mono text-sm"
        />

        {analyzeError && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
            <p className="text-[12px] text-destructive">{analyzeError}</p>
          </div>
        )}

        {!preview && (
          <div className="flex items-center justify-between">
            <p className="text-[12px] text-muted-foreground">
              Paste a URL or raw JSON/YAML content.
            </p>
            <Button
              disabled={!specUrl.trim() || analyzing}
              onClick={handleAnalyze}
            >
              {analyzing && <Spinner className="size-3.5" />}
              {analyzing ? "Analyzing…" : "Analyze"}
            </Button>
          </div>
        )}
      </section>

      {/* ── Everything below appears after analysis ── */}
      {preview && (
        <>
          {/* API info */}
          <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-card-foreground leading-none truncate">
                {Option.getOrElse(preview.title, () => "API")}
              </p>
              <p className="mt-1 text-[12px] text-muted-foreground leading-none">
                {Option.getOrElse(preview.version, () => "")}
                {Option.isSome(preview.version) && " · "}
                {preview.operationCount} operation{preview.operationCount !== 1 ? "s" : ""}
                {preview.tags.length > 0 && ` · ${preview.tags.length} tag${preview.tags.length !== 1 ? "s" : ""}`}
              </p>
            </div>
            {preview.tags.length > 0 && (
              <div className="hidden sm:flex flex-wrap gap-1 max-w-[200px] justify-end">
                {preview.tags.slice(0, 4).map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-[10px]">
                    {tag}
                  </Badge>
                ))}
                {preview.tags.length > 4 && (
                  <span className="text-[10px] text-muted-foreground">+{preview.tags.length - 4}</span>
                )}
              </div>
            )}
          </div>

          {/* Base URL */}
          <section className="space-y-2">
            <Label>Base URL</Label>

            {servers.length > 1 ? (
              <div className="space-y-2">
                <RadioGroup
                  value={baseUrl}
                  onValueChange={setBaseUrl}
                  className="gap-1.5"
                >
                  {servers.map((s, i) => {
                    const url = s.url ?? "";
                    return (
                      <label
                        key={i}
                        className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 cursor-pointer transition-colors ${
                          baseUrl === url
                            ? "border-primary/50 bg-primary/[0.03]"
                            : "border-border hover:bg-accent/50"
                        }`}
                      >
                        <RadioGroupItem value={url} />
                        <span className="font-mono text-xs text-foreground truncate">{url}</span>
                      </label>
                    );
                  })}
                </RadioGroup>
                <Input
                  value={baseUrl}
                  onChange={(e) => setBaseUrl((e.target as HTMLInputElement).value)}
                  placeholder="Or enter a custom URL…"
                  className="font-mono text-sm"
                />
              </div>
            ) : (
              <Input
                value={baseUrl}
                onChange={(e) => setBaseUrl((e.target as HTMLInputElement).value)}
                placeholder="https://api.example.com"
                className="font-mono text-sm"
              />
            )}

            {!baseUrl.trim() && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400">
                A base URL is required to make requests.
              </p>
            )}
          </section>

          {/* Authentication */}
          <section className="space-y-2.5">
            <Label>Authentication</Label>

            {/* Spec-detected auth strategies */}
            {hasAuth && (
              <RadioGroup
                value={String(presetIndex)}
                onValueChange={(v) => selectPreset(Number(v))}
                className="gap-1.5"
              >
                {presets.map((preset, i) => {
                  const isSelected = presetIndex === i;
                  return (
                    <div key={i}>
                      <label
                        className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 cursor-pointer transition-colors ${
                          isSelected
                            ? "border-primary/50 bg-primary/[0.03]"
                            : "border-border hover:bg-accent/50"
                        }`}
                      >
                        <RadioGroupItem value={String(i)} />
                        <span className="text-xs font-medium text-foreground">{preset.label}</span>
                        {preset.secretHeaders.length > 0 && (
                          <span className="ml-auto text-[10px] text-muted-foreground">
                            {preset.secretHeaders.length} secret{preset.secretHeaders.length > 1 ? "s" : ""}
                          </span>
                        )}
                      </label>

                      {isSelected && preset.secretHeaders.length > 0 && (
                        <div className="mt-1.5 ml-6 space-y-2.5 pb-1">
                          {preset.secretHeaders.map((headerName) => {
                            const currentValue = headers[headerName];
                            const currentSecretId =
                              currentValue && typeof currentValue === "object" && "secretId" in currentValue
                                ? currentValue.secretId
                                : null;
                            return (
                              <HeaderSecretRow
                                key={headerName}
                                headerName={headerName}
                                prefix={prefixForHeader(preset, headerName)}
                                selectedSecretId={currentSecretId}
                                onSelect={(sid) => setSecretForHeader(headerName, sid)}
                                existingSecrets={secretList}
                              />
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}

                <label
                  className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 cursor-pointer transition-colors ${
                    presetIndex === -1
                      ? "border-primary/50 bg-primary/[0.03]"
                      : "border-border hover:bg-accent/50"
                  }`}
                >
                  <RadioGroupItem value="-1" />
                  <span className="text-xs font-medium text-foreground">None</span>
                  <span className="ml-auto text-[10px] text-muted-foreground">skip auth</span>
                </label>
              </RadioGroup>
            )}

            {/* Custom headers — always available */}
            {customHeaders.length > 0 && (
              <div className="space-y-2">
                {hasAuth && (
                  <div className="flex items-center gap-3 pt-1">
                    <Separator className="flex-1" />
                    <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Custom headers</span>
                    <Separator className="flex-1" />
                  </div>
                )}
                {customHeaders.map((ch, i) => (
                  <CustomHeaderRow
                    key={i}
                    name={ch.name}
                    secretId={ch.secretId}
                    onChangeName={(name) => updateCustomHeader(i, { name })}
                    onSelectSecret={(secretId) => updateCustomHeader(i, { secretId })}
                    onRemove={() => removeCustomHeader(i)}
                    existingSecrets={secretList}
                  />
                ))}
              </div>
            )}

            <Button
              variant="outline"
              size="sm"
              className="w-full border-dashed"
              onClick={addCustomHeader}
            >
              + Add header
            </Button>
          </section>

          {/* Add error */}
          {addError && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
              <p className="text-[12px] text-destructive">{addError}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-between border-t border-border pt-4">
            <Button variant="ghost" onClick={props.onCancel} disabled={adding}>
              Cancel
            </Button>
            <Button onClick={handleAdd} disabled={!canAdd || adding}>
              {adding && <Spinner className="size-3.5" />}
              {adding ? "Adding…" : "Add source"}
            </Button>
          </div>
        </>
      )}

      {/* Cancel when no preview yet */}
      {!preview && (
        <div className="flex items-center justify-between pt-1">
          <Button variant="ghost" onClick={props.onCancel}>
            Cancel
          </Button>
          <div />
        </div>
      )}
    </div>
  );
}
