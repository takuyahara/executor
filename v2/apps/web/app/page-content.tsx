"use client";

import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect-atom/atom-react";
import type {
  ListStorageKvResult,
  QueryStorageSqlResult,
  StorageDirectoryEntry,
} from "@executor-v2/management-api/storage/api";
import type {
  Approval,
  ApprovalId,
  CredentialProvider,
  CredentialScopeType,
  Organization,
  Policy,
  PolicyDecision,
  PolicyId,
  SourceCredentialBinding,
  SourceId,
  StorageDurability,
  StorageInstance,
  StorageScopeType,
  Workspace,
  WorkspaceId,
} from "@executor-v2/schema";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import {
  approvalsByWorkspace,
  approvalsResultByWorkspace,
  closeStorageInstance,
  credentialBindingsByWorkspace,
  credentialBindingsResultByWorkspace,
  listStorageDirectory,
  listStorageKv,
  openStorageInstance,
  optimisticRemovePolicy,
  optimisticRemoveSources,
  optimisticResolveApproval,
  optimisticSourcesByWorkspace,
  optimisticUpsertPolicy,
  optimisticUpsertSources,
  organizationsResult,
  organizationsState,
  policiesByWorkspace,
  policiesResultByWorkspace,
  queryStorageSql,
  readStorageFile,
  removeCredentialBinding,
  removePolicy,
  removeSource,
  removeStorageInstance,
  resolveApproval,
  sourcesByWorkspace,
  sourcesPendingByWorkspace,
  sourcesResultByWorkspace,
  storageByWorkspace,
  storageResultByWorkspace,
  toCredentialBindingRemoveResult,
  toCredentialBindingUpsertPayload,
  toListStorageDirectoryPayload,
  toListStorageKvPayload,
  toOpenStoragePayload,
  toOrganizationUpsertPayload,
  toPolicyRemoveResult,
  toPolicyUpsertPayload,
  toQueryStorageSqlPayload,
  toReadStorageFilePayload,
  toStorageDirectoryResult,
  toStorageKvResult,
  toStorageReadFileResult,
  toStorageRemoveResult,
  toStorageSqlResult,
  toWorkspaceUpsertPayload,
  upsertCredentialBinding,
  upsertOrganization,
  upsertPolicy,
  upsertSource,
  upsertWorkspace,
  workspaceToolsByWorkspace,
  workspaceToolsResultByWorkspace,
  workspacesResult,
  workspacesState,
} from "../lib/control-plane/atoms";
import {
  formStateFromSource,
  sourceToLegacyRecord,
  upsertPayloadFromForm,
  type LegacySourceFormState,
  type LegacySourceType,
} from "../lib/control-plane/legacy-source";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Select } from "../components/ui/select";
import { cn } from "../lib/utils";

const kindOptions: ReadonlyArray<LegacySourceType> = ["openapi", "mcp", "graphql"];

const catalogTemplates = [
  {
    name: "GitHub",
    type: "openapi" as const,
    endpoint:
      "https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/api.github.com/api.github.com.yaml",
  },
  {
    name: "OpenAI",
    type: "openapi" as const,
    endpoint:
      "https://app.stainless.com/api/spec/documented/openai/openapi.documented.yml",
  },
  {
    name: "Linear",
    type: "graphql" as const,
    endpoint: "https://api.linear.app/graphql",
  },
  {
    name: "Generic MCP",
    type: "mcp" as const,
    endpoint: "https://example.com/mcp",
  },
] as const;

const defaultFormState = (): LegacySourceFormState => ({
  name: "",
  type: "openapi",
  endpoint: "",
  baseUrl: "",
  mcpTransport: "auto",
  authType: "none",
  authMode: "workspace",
  apiKeyHeader: "Authorization",
  enabled: true,
});

const createLocalId = (prefix: string): string => {
  const randomPart =
    typeof globalThis.crypto !== "undefined"
    && typeof globalThis.crypto.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

  return `${prefix}${randomPart}`;
};

type PageProps = {
  authEnabled: boolean;
  initialWorkspaceId: string;
};

type ConsoleTab =
  | "sources"
  | "tools"
  | "credentials"
  | "policies"
  | "organizations"
  | "workspaces"
  | "storage"
  | "approvals";
type ApprovalFilter = "pending" | "resolved" | "all";

const formatTimestamp = (value: number | null): string => {
  if (value === null) {
    return "-";
  }

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
};

const previewFromInputJson = (inputPreviewJson: string): string => {
  const trimmed = inputPreviewJson.trim();
  if (trimmed.length === 0) {
    return "{}";
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const pretty = JSON.stringify(parsed, null, 2);
    return pretty.length > 640 ? `${pretty.slice(0, 640)}\n...` : pretty;
  } catch {
    return trimmed.length > 640 ? `${trimmed.slice(0, 640)}...` : trimmed;
  }
};

const statusBadgeVariant = (
  status: Approval["status"],
): "pending" | "approved" | "denied" | "outline" => {
  if (status === "pending") return "pending";
  if (status === "approved") return "approved";
  if (status === "denied") return "denied";
  return "outline";
};

const Page = ({ authEnabled, initialWorkspaceId }: PageProps) => {
  const [activeTab, setActiveTab] = useState<ConsoleTab>("sources");
  const [workspaceIdInput, setWorkspaceIdInput] = useState(initialWorkspaceId);
  const [formState, setFormState] = useState<LegacySourceFormState>(() =>
    defaultFormState(),
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [statusText, setStatusText] = useState<string | null>(null);
  const [toolsRefreshPending, setToolsRefreshPending] = useState(false);
  const [toolSearchQuery, setToolSearchQuery] = useState("");
  const [selectedToolSourceId, setSelectedToolSourceId] = useState<SourceId | "all">("all");

  const [organizationIdInput, setOrganizationIdInput] = useState("");
  const [organizationSlugInput, setOrganizationSlugInput] = useState("");
  const [organizationNameInput, setOrganizationNameInput] = useState("");
  const [organizationStatusInput, setOrganizationStatusInput] =
    useState<Organization["status"]>("active");
  const [organizationStatusText, setOrganizationStatusText] = useState<string | null>(null);

  const [workspaceEditIdInput, setWorkspaceEditIdInput] = useState("");
  const [workspaceNameInput, setWorkspaceNameInput] = useState("");
  const [workspaceOrganizationIdInput, setWorkspaceOrganizationIdInput] = useState("");
  const [workspaceStatusText, setWorkspaceStatusText] = useState<string | null>(null);

  const [credentialSourceKey, setCredentialSourceKey] = useState("");
  const [credentialProvider, setCredentialProvider] =
    useState<CredentialProvider>("api_key");
  const [credentialScopeType, setCredentialScopeType] =
    useState<CredentialScopeType>("workspace");
  const [credentialIdInput, setCredentialIdInput] = useState("");
  const [credentialSecretRef, setCredentialSecretRef] = useState("");
  const [credentialAccountId, setCredentialAccountId] = useState("");
  const [credentialAdditionalHeadersJson, setCredentialAdditionalHeadersJson] =
    useState("");
  const [credentialBoundAuthFingerprint, setCredentialBoundAuthFingerprint] =
    useState("");
  const [credentialEditingId, setCredentialEditingId] =
    useState<SourceCredentialBinding["id"] | null>(null);
  const [credentialSearchQuery, setCredentialSearchQuery] = useState("");
  const [credentialStatusText, setCredentialStatusText] = useState<string | null>(
    null,
  );
  const [credentialBusyId, setCredentialBusyId] =
    useState<SourceCredentialBinding["id"] | null>(null);

  const [policyPattern, setPolicyPattern] = useState("");
  const [policyDecision, setPolicyDecision] = useState<PolicyDecision>("require_approval");
  const [policyEditingId, setPolicyEditingId] = useState<PolicyId | null>(null);
  const [policySearchQuery, setPolicySearchQuery] = useState("");
  const [policyStatusText, setPolicyStatusText] = useState<string | null>(null);
  const [policyBusyId, setPolicyBusyId] = useState<PolicyId | null>(null);
  const [optimisticPolicies, setOptimisticPolicies] = useState<
    ReadonlyArray<Policy> | null
  >(null);

  const [storageScopeType, setStorageScopeType] =
    useState<StorageScopeType>("scratch");
  const [storageDurability, setStorageDurability] =
    useState<StorageDurability>("ephemeral");
  const [storageProvider, setStorageProvider] =
    useState<StorageInstance["provider"]>("agentfs-local");
  const [storagePurposeInput, setStoragePurposeInput] = useState("");
  const [storageTtlHoursInput, setStorageTtlHoursInput] = useState("24");
  const [storageAccountIdInput, setStorageAccountIdInput] = useState("");
  const [storageSearchQuery, setStorageSearchQuery] = useState("");
  const [storageStatusText, setStorageStatusText] = useState<string | null>(null);
  const [storageBusyId, setStorageBusyId] = useState<string | null>(null);
  const [storageSelectedId, setStorageSelectedId] = useState<StorageInstance["id"] | null>(
    null,
  );
  const [storageDirectoryPath, setStorageDirectoryPath] = useState("/");
  const [storageDirectoryEntries, setStorageDirectoryEntries] = useState<
    ReadonlyArray<StorageDirectoryEntry>
  >([]);
  const [storageDirectoryBusy, setStorageDirectoryBusy] = useState(false);
  const [storageFilePreviewPath, setStorageFilePreviewPath] = useState<string | null>(null);
  const [storageFilePreviewContent, setStorageFilePreviewContent] = useState("");
  const [storageFilePreviewBusy, setStorageFilePreviewBusy] = useState(false);
  const [storageKvPrefix, setStorageKvPrefix] = useState("");
  const [storageKvLimit, setStorageKvLimit] = useState("100");
  const [storageKvItems, setStorageKvItems] = useState<
    ReadonlyArray<ListStorageKvResult["items"][number]>
  >([]);
  const [storageKvBusy, setStorageKvBusy] = useState(false);
  const [storageSqlText, setStorageSqlText] = useState("SELECT name FROM sqlite_master LIMIT 50");
  const [storageSqlMaxRows, setStorageSqlMaxRows] = useState("200");
  const [storageSqlResult, setStorageSqlResult] = useState<QueryStorageSqlResult | null>(
    null,
  );
  const [storageSqlBusy, setStorageSqlBusy] = useState(false);

  const [approvalFilter, setApprovalFilter] = useState<ApprovalFilter>("pending");
  const [approvalSearchQuery, setApprovalSearchQuery] = useState("");
  const [approvalStatusText, setApprovalStatusText] = useState<string | null>(null);
  const [approvalBusyId, setApprovalBusyId] = useState<ApprovalId | null>(null);
  const [optimisticApprovals, setOptimisticApprovals] = useState<
    ReadonlyArray<Approval> | null
  >(null);

  const workspaceId = workspaceIdInput as WorkspaceId;

  const sources = useAtomValue(sourcesByWorkspace(workspaceId));
  const sourcesPending = useAtomValue(sourcesPendingByWorkspace(workspaceId));
  const refreshSources = useAtomRefresh(sourcesResultByWorkspace(workspaceId));

  const credentialBindingsState = useAtomValue(
    credentialBindingsByWorkspace(workspaceId),
  );
  const refreshCredentialBindings = useAtomRefresh(
    credentialBindingsResultByWorkspace(workspaceId),
  );

  const policiesState = useAtomValue(policiesByWorkspace(workspaceId));
  const refreshPolicies = useAtomRefresh(policiesResultByWorkspace(workspaceId));

  const storageState = useAtomValue(storageByWorkspace(workspaceId));
  const refreshStorage = useAtomRefresh(storageResultByWorkspace(workspaceId));

  const approvalsState = useAtomValue(approvalsByWorkspace(workspaceId));
  const refreshApprovals = useAtomRefresh(approvalsResultByWorkspace(workspaceId));

  const organizations = useAtomValue(organizationsState);
  const refreshOrganizations = useAtomRefresh(organizationsResult);

  const workspaces = useAtomValue(workspacesState);
  const refreshWorkspaces = useAtomRefresh(workspacesResult);

  const workspaceTools = useAtomValue(workspaceToolsByWorkspace(workspaceId));
  const refreshWorkspaceTools = useAtomRefresh(
    workspaceToolsResultByWorkspace(workspaceId),
  );
  const runUpsertSource = useAtomSet(upsertSource, { mode: "promise" });
  const runRemoveSource = useAtomSet(removeSource, { mode: "promise" });
  const runUpsertCredentialBinding = useAtomSet(upsertCredentialBinding, {
    mode: "promise",
  });
  const runRemoveCredentialBinding = useAtomSet(removeCredentialBinding, {
    mode: "promise",
  });
  const runUpsertPolicy = useAtomSet(upsertPolicy, { mode: "promise" });
  const runRemovePolicy = useAtomSet(removePolicy, { mode: "promise" });
  const runUpsertOrganization = useAtomSet(upsertOrganization, { mode: "promise" });
  const runUpsertWorkspace = useAtomSet(upsertWorkspace, { mode: "promise" });
  const runOpenStorageInstance = useAtomSet(openStorageInstance, { mode: "promise" });
  const runCloseStorageInstance = useAtomSet(closeStorageInstance, { mode: "promise" });
  const runRemoveStorageInstance = useAtomSet(removeStorageInstance, {
    mode: "promise",
  });
  const runListStorageDirectory = useAtomSet(listStorageDirectory, {
    mode: "promise",
  });
  const runReadStorageFile = useAtomSet(readStorageFile, { mode: "promise" });
  const runListStorageKv = useAtomSet(listStorageKv, { mode: "promise" });
  const runQueryStorageSql = useAtomSet(queryStorageSql, { mode: "promise" });
  const runResolveApproval = useAtomSet(resolveApproval, { mode: "promise" });
  const setOptimisticSources = useAtomSet(
    optimisticSourcesByWorkspace(workspaceId),
  );

  const sourceItems = useMemo(
    () => sources.items.map(sourceToLegacyRecord),
    [sources.items],
  );

  const credentialItems = useMemo(
    () => credentialBindingsState.items,
    [credentialBindingsState.items],
  );

  const policyItems = useMemo(
    () => optimisticPolicies ?? policiesState.items,
    [optimisticPolicies, policiesState.items],
  );

  const storageItems = useMemo(
    () => storageState.items,
    [storageState.items],
  );

  const selectedStorageInstance = useMemo(() => {
    if (storageItems.length === 0) {
      return null;
    }

    if (storageSelectedId === null) {
      return storageItems[0] ?? null;
    }

    return storageItems.find((instance) => instance.id === storageSelectedId)
      ?? storageItems[0]
      ?? null;
  }, [storageItems, storageSelectedId]);

  useEffect(() => {
    if (selectedStorageInstance === null) {
      if (storageSelectedId !== null) {
        setStorageSelectedId(null);
      }
      return;
    }

    if (storageSelectedId !== selectedStorageInstance.id) {
      setStorageSelectedId(selectedStorageInstance.id);
    }
  }, [selectedStorageInstance, storageSelectedId]);

  useEffect(() => {
    if (workspaceNameInput.trim().length > 0) {
      return;
    }

    const current = workspaces.items.find((workspace) => workspace.id === workspaceId);
    if (!current) {
      return;
    }

    setWorkspaceEditIdInput(current.id);
    setWorkspaceNameInput(current.name);
    setWorkspaceOrganizationIdInput(current.organizationId ?? "");
  }, [workspaceId, workspaceNameInput, workspaces.items]);

  useEffect(() => {
    if (organizationIdInput.trim().length > 0) {
      return;
    }

    const currentWorkspace = workspaces.items.find((workspace) => workspace.id === workspaceId);
    if (!currentWorkspace?.organizationId) {
      return;
    }

    const currentOrganization = organizations.items.find(
      (organization) => organization.id === currentWorkspace.organizationId,
    );

    if (!currentOrganization) {
      return;
    }

    setOrganizationIdInput(currentOrganization.id);
    setOrganizationSlugInput(currentOrganization.slug);
    setOrganizationNameInput(currentOrganization.name);
    setOrganizationStatusInput(currentOrganization.status);
  }, [organizationIdInput, organizations.items, workspaceId, workspaces.items]);

  const approvalItems = useMemo(
    () => optimisticApprovals ?? approvalsState.items,
    [approvalsState.items, optimisticApprovals],
  );

  const toolItems = useMemo(() => workspaceTools.items, [workspaceTools.items]);

  const filteredToolItems = useMemo(() => {
    const query = toolSearchQuery.trim().toLowerCase();

    return toolItems.filter((tool) => {
      if (selectedToolSourceId !== "all" && tool.sourceId !== selectedToolSourceId) {
        return false;
      }

      if (query.length === 0) {
        return true;
      }

      return (
        tool.sourceName.toLowerCase().includes(query)
        || tool.name.toLowerCase().includes(query)
        || tool.toolId.toLowerCase().includes(query)
        || `${tool.method} ${tool.path}`.toLowerCase().includes(query)
      );
    });
  }, [selectedToolSourceId, toolItems, toolSearchQuery]);

  const filteredSourceItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (query.length === 0) {
      return sourceItems;
    }

    return sourceItems.filter((source) => {
      return (
        source.name.toLowerCase().includes(query)
        || source.type.toLowerCase().includes(query)
        || source.endpoint.toLowerCase().includes(query)
      );
    });
  }, [searchQuery, sourceItems]);

  const filteredCredentials = useMemo(() => {
    const query = credentialSearchQuery.trim().toLowerCase();
    if (query.length === 0) {
      return credentialItems;
    }

    return credentialItems.filter((binding) =>
      binding.sourceKey.toLowerCase().includes(query)
      || binding.provider.toLowerCase().includes(query)
      || binding.scopeType.toLowerCase().includes(query)
      || binding.secretRef.toLowerCase().includes(query),
    );
  }, [credentialItems, credentialSearchQuery]);

  const filteredPolicies = useMemo(() => {
    const query = policySearchQuery.trim().toLowerCase();
    if (query.length === 0) {
      return policyItems;
    }

    return policyItems.filter((policy) =>
      policy.toolPathPattern.toLowerCase().includes(query)
      || policy.decision.toLowerCase().includes(query),
    );
  }, [policyItems, policySearchQuery]);

  const filteredStorageItems = useMemo(() => {
    const query = storageSearchQuery.trim().toLowerCase();
    if (query.length === 0) {
      return storageItems;
    }

    return storageItems.filter((storageInstance) => {
      return (
        storageInstance.scopeType.toLowerCase().includes(query)
        || storageInstance.durability.toLowerCase().includes(query)
        || storageInstance.status.toLowerCase().includes(query)
        || storageInstance.provider.toLowerCase().includes(query)
        || storageInstance.backendKey.toLowerCase().includes(query)
        || (storageInstance.purpose?.toLowerCase().includes(query) ?? false)
      );
    });
  }, [storageItems, storageSearchQuery]);

  const filteredApprovals = useMemo(() => {
    const query = approvalSearchQuery.trim().toLowerCase();

    return approvalItems.filter((approval) => {
      if (approvalFilter === "pending" && approval.status !== "pending") {
        return false;
      }

      if (
        approvalFilter === "resolved"
        && (approval.status === "pending" || approval.status === "expired")
      ) {
        return false;
      }

      if (query.length === 0) {
        return true;
      }

      return (
        approval.toolPath.toLowerCase().includes(query)
        || approval.status.toLowerCase().includes(query)
        || approval.callId.toLowerCase().includes(query)
        || approval.taskRunId.toLowerCase().includes(query)
      );
    });
  }, [approvalFilter, approvalItems, approvalSearchQuery]);

  const pendingApprovalCount = useMemo(
    () => approvalItems.filter((approval) => approval.status === "pending").length,
    [approvalItems],
  );

  const isEditing = Boolean(formState.id);

  const handleWorkspaceChange = (value: string) => {
    setWorkspaceIdInput(value);
    setStatusText(null);
    setCredentialStatusText(null);
    setPolicyStatusText(null);
    setStorageStatusText(null);
    setApprovalStatusText(null);
    setOrganizationStatusText(null);
    setWorkspaceStatusText(null);
    setSearchQuery("");
    setToolSearchQuery("");
    setCredentialSearchQuery("");
    setPolicySearchQuery("");
    setStorageSearchQuery("");
    setApprovalSearchQuery("");

    setCredentialSourceKey("");
    setCredentialProvider("api_key");
    setCredentialScopeType("workspace");
    setCredentialIdInput("");
    setCredentialSecretRef("");
    setCredentialAccountId("");
    setCredentialAdditionalHeadersJson("");
    setCredentialBoundAuthFingerprint("");
    setCredentialEditingId(null);
    setCredentialBusyId(null);

    setPolicyPattern("");
    setPolicyDecision("require_approval");
    setPolicyEditingId(null);

    setStorageScopeType("scratch");
    setStorageDurability("ephemeral");
    setStorageProvider("agentfs-local");
    setStoragePurposeInput("");
    setStorageTtlHoursInput("24");
    setStorageAccountIdInput("");
    setStorageBusyId(null);
    setStorageSelectedId(null);
    setStorageDirectoryPath("/");
    setStorageDirectoryEntries([]);
    setStorageDirectoryBusy(false);
    setStorageFilePreviewPath(null);
    setStorageFilePreviewContent("");
    setStorageFilePreviewBusy(false);
    setStorageKvPrefix("");
    setStorageKvLimit("100");
    setStorageKvItems([]);
    setStorageKvBusy(false);
    setStorageSqlText("SELECT name FROM sqlite_master LIMIT 50");
    setStorageSqlMaxRows("200");
    setStorageSqlResult(null);
    setStorageSqlBusy(false);

    setOrganizationIdInput("");
    setOrganizationSlugInput("");
    setOrganizationNameInput("");
    setOrganizationStatusInput("active");
    setWorkspaceEditIdInput("");
    setWorkspaceNameInput("");
    setWorkspaceOrganizationIdInput("");
    setSelectedToolSourceId("all");

    setFormState(defaultFormState());
    setOptimisticPolicies(null);
    setOptimisticApprovals(null);
  };

  const setFormField = <K extends keyof LegacySourceFormState>(
    key: K,
    value: LegacySourceFormState[K],
  ) => {
    setFormState((current) => ({
      ...current,
      [key]: value,
    }));
  };

  const resetForm = () => {
    setFormState(defaultFormState());
  };

  const handleTemplateUse = (template: (typeof catalogTemplates)[number]) => {
    setFormState((current) => ({
      ...current,
      id: undefined,
      name: template.name,
      type: template.type,
      endpoint: template.endpoint,
      baseUrl: "",
      mcpTransport: "auto",
    }));
    setStatusText(`Loaded template for ${template.name}.`);
  };

  const handleEdit = (sourceId: SourceId) => {
    const source = sourceItems.find((item) => item.id === sourceId);
    if (!source) {
      return;
    }

    setFormState(formStateFromSource(source));
    setStatusText(`Editing ${source.name}.`);
  };

  const handleCancelEdit = () => {
    resetForm();
    setStatusText("Edit cancelled.");
  };

  const handleUpsertOrganization = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const slug = organizationSlugInput.trim();
    const name = organizationNameInput.trim();
    const id = organizationIdInput.trim();

    if (slug.length === 0 || name.length === 0) {
      setOrganizationStatusText("Organization slug and name are required.");
      return;
    }

    void runUpsertOrganization({
      payload: toOrganizationUpsertPayload({
        id: id.length > 0 ? (id as Organization["id"]) : undefined,
        slug,
        name,
        status: organizationStatusInput,
      }),
    })
      .then((organization) => {
        setOrganizationStatusText(`Saved organization ${organization.slug}.`);
        setOrganizationIdInput(organization.id);
        refreshOrganizations();
      })
      .catch(() => {
        setOrganizationStatusText("Organization save failed.");
        refreshOrganizations();
      });
  };

  const handleUpsertWorkspace = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const name = workspaceNameInput.trim();
    const id = workspaceEditIdInput.trim();
    const organizationId = workspaceOrganizationIdInput.trim();

    if (name.length === 0) {
      setWorkspaceStatusText("Workspace name is required.");
      return;
    }

    void runUpsertWorkspace({
      payload: toWorkspaceUpsertPayload({
        id: id.length > 0 ? (id as Workspace["id"]) : undefined,
        name,
        organizationId:
          organizationId.length > 0
            ? (organizationId as Workspace["organizationId"])
            : null,
      }),
    })
      .then((workspace) => {
        setWorkspaceStatusText(`Saved workspace ${workspace.name}.`);
        setWorkspaceEditIdInput(workspace.id);
        setWorkspaceOrganizationIdInput(workspace.organizationId ?? "");
        setWorkspaceIdInput(workspace.id);
        refreshWorkspaces();
      })
      .catch(() => {
        setWorkspaceStatusText("Workspace save failed.");
        refreshWorkspaces();
      });
  };

  const handleLoadWorkspace = (workspace: Workspace) => {
    setWorkspaceEditIdInput(workspace.id);
    setWorkspaceNameInput(workspace.name);
    setWorkspaceOrganizationIdInput(workspace.organizationId ?? "");
    setWorkspaceIdInput(workspace.id);
    setWorkspaceStatusText(`Loaded workspace ${workspace.id}.`);
  };

  const handleLoadOrganization = (organization: Organization) => {
    setOrganizationIdInput(organization.id);
    setOrganizationSlugInput(organization.slug);
    setOrganizationNameInput(organization.name);
    setOrganizationStatusInput(organization.status);
    setOrganizationStatusText(`Loaded organization ${organization.slug}.`);
  };

  const handleUpsertSource = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (sourcesPending) {
      return;
    }

    if (formState.name.trim().length === 0 || formState.endpoint.trim().length === 0) {
      setStatusText("Name and endpoint are required.");
      return;
    }

    const sourceId = formState.id ?? (createLocalId("src_") as SourceId);
    const payload = upsertPayloadFromForm({
      workspaceId,
      form: formState,
      sourceId,
    });

    const previousSources = sources.items;
    const optimistic = optimisticUpsertSources(previousSources, workspaceId, payload);

    setOptimisticSources({
      items: optimistic.items,
      pendingAck: {
        kind: "upsert",
        sourceId: optimistic.sourceId,
      },
    });

    void runUpsertSource({
      path: { workspaceId },
      payload,
    })
      .then(() => {
        setStatusText(
          isEditing
            ? `Updated ${formState.name.trim()}.`
            : `Saved ${formState.name.trim()}.`,
        );
        resetForm();
        refreshSources();
      })
      .catch(() => {
        setStatusText("Source save failed.");
        setOptimisticSources(null);
        refreshSources();
      });
  };

  const handleRemoveSource = (sourceId: SourceId) => {
    if (sourcesPending) {
      return;
    }

    const previousSources = sources.items;
    const optimistic = optimisticRemoveSources(previousSources, sourceId);

    setOptimisticSources({
      items: optimistic.items,
      pendingAck: {
        kind: "remove",
        sourceId: optimistic.sourceId,
      },
    });

    void runRemoveSource({
      path: { workspaceId, sourceId },
    })
      .then(() => {
        setStatusText("Source removed.");
        if (formState.id === sourceId) {
          resetForm();
        }
        refreshSources();
      })
      .catch(() => {
        setStatusText("Source removal failed.");
        setOptimisticSources(null);
        refreshSources();
      });
  };

  const handleRefreshTools = async () => {
    if (sourcesPending || toolsRefreshPending) {
      return;
    }

    const openApiSources = sourceItems.filter((source) => source.type === "openapi");
    if (openApiSources.length === 0) {
      setStatusText("No OpenAPI sources available to refresh.");
      refreshWorkspaceTools();
      return;
    }

    setToolsRefreshPending(true);
    setStatusText(
      `Refreshing tools for ${openApiSources.length} OpenAPI source${
        openApiSources.length === 1 ? "" : "s"
      }...`,
    );

    try {
      await Promise.all(
        openApiSources.map((source) =>
          runUpsertSource({
            path: { workspaceId },
            payload: upsertPayloadFromForm({
              workspaceId,
              sourceId: source.id,
              form: formStateFromSource(source),
            }),
          }),
        ),
      );

      setStatusText(
        `Refreshed tools for ${openApiSources.length} OpenAPI source${
          openApiSources.length === 1 ? "" : "s"
        }.`,
      );
    } catch {
      setStatusText("Tool refresh failed.");
    } finally {
      refreshSources();
      refreshWorkspaceTools();
      setToolsRefreshPending(false);
    }
  };


  const handleEditCredential = (credentialBindingId: SourceCredentialBinding["id"]) => {
    const binding = credentialItems.find((item) => item.id === credentialBindingId);
    if (!binding) {
      return;
    }

    setCredentialEditingId(binding.id);
    setCredentialSourceKey(binding.sourceKey);
    setCredentialProvider(binding.provider);
    setCredentialScopeType(binding.scopeType);
    setCredentialIdInput(binding.credentialId);
    setCredentialSecretRef(binding.secretRef);
    setCredentialAccountId(binding.accountId ?? "");
    setCredentialAdditionalHeadersJson(binding.additionalHeadersJson ?? "");
    setCredentialBoundAuthFingerprint(binding.boundAuthFingerprint ?? "");
    setCredentialStatusText(`Editing credential binding ${binding.sourceKey}.`);
  };

  const handleCancelCredentialEdit = () => {
    setCredentialEditingId(null);
    setCredentialSourceKey("");
    setCredentialProvider("api_key");
    setCredentialScopeType("workspace");
    setCredentialIdInput("");
    setCredentialSecretRef("");
    setCredentialAccountId("");
    setCredentialAdditionalHeadersJson("");
    setCredentialBoundAuthFingerprint("");
    setCredentialStatusText("Credential edit cancelled.");
  };

  const handleUpsertCredential = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (credentialBusyId !== null) {
      return;
    }

    const sourceKey = credentialSourceKey.trim();
    const credentialId = credentialIdInput.trim();
    const secretRef = credentialSecretRef.trim();
    const accountId = credentialAccountId.trim();

    if (sourceKey.length === 0 || credentialId.length === 0 || secretRef.length === 0) {
      setCredentialStatusText("Source key, credential id, and secret ref are required.");
      return;
    }

    if (credentialScopeType === "account" && accountId.length === 0) {
      setCredentialStatusText("Account scope credentials require account id.");
      return;
    }

    const requestId =
      credentialEditingId
      ?? (createLocalId("credential_binding_") as SourceCredentialBinding["id"]);

    setCredentialBusyId(requestId);

    void runUpsertCredentialBinding({
      path: { workspaceId },
      payload: toCredentialBindingUpsertPayload({
        id: credentialEditingId ?? undefined,
        credentialId: credentialId as SourceCredentialBinding["credentialId"],
        scopeType: credentialScopeType,
        sourceKey,
        provider: credentialProvider,
        secretRef,
        accountId: credentialScopeType === "account"
          ? (accountId as SourceCredentialBinding["accountId"])
          : null,
        additionalHeadersJson:
          credentialAdditionalHeadersJson.trim().length > 0
            ? credentialAdditionalHeadersJson.trim()
            : null,
        boundAuthFingerprint:
          credentialBoundAuthFingerprint.trim().length > 0
            ? credentialBoundAuthFingerprint.trim()
            : null,
      }),
    })
      .then(() => {
        setCredentialStatusText(
          credentialEditingId
            ? `Updated credential binding ${sourceKey}.`
            : `Added credential binding ${sourceKey}.`,
        );
        setCredentialEditingId(null);
        setCredentialSourceKey("");
        setCredentialProvider("api_key");
        setCredentialScopeType("workspace");
        setCredentialIdInput("");
        setCredentialSecretRef("");
        setCredentialAccountId("");
        setCredentialAdditionalHeadersJson("");
        setCredentialBoundAuthFingerprint("");
        refreshCredentialBindings();
      })
      .catch(() => {
        setCredentialStatusText("Credential save failed.");
        refreshCredentialBindings();
      })
      .finally(() => {
        setCredentialBusyId(null);
      });
  };

  const handleRemoveCredential = (credentialBindingId: SourceCredentialBinding["id"]) => {
    if (credentialBusyId !== null) {
      return;
    }

    setCredentialBusyId(credentialBindingId);

    void runRemoveCredentialBinding({
      path: {
        workspaceId,
        credentialBindingId,
      },
    })
      .then((result) => {
        const removed = toCredentialBindingRemoveResult(result);
        setCredentialStatusText(
          removed ? "Credential binding removed." : "Credential binding not found.",
        );

        if (credentialEditingId === credentialBindingId) {
          handleCancelCredentialEdit();
        }

        refreshCredentialBindings();
      })
      .catch(() => {
        setCredentialStatusText("Credential removal failed.");
        refreshCredentialBindings();
      })
      .finally(() => {
        setCredentialBusyId(null);
      });
  };

  const handleEditPolicy = (policyId: PolicyId) => {
    const policy = policyItems.find((item) => item.id === policyId);
    if (!policy) {
      return;
    }

    setPolicyEditingId(policy.id);
    setPolicyPattern(policy.toolPathPattern);
    setPolicyDecision(policy.decision);
    setPolicyStatusText(`Editing policy ${policy.toolPathPattern}.`);
  };

  const handleCancelPolicyEdit = () => {
    setPolicyEditingId(null);
    setPolicyPattern("");
    setPolicyDecision("require_approval");
    setPolicyStatusText("Policy edit cancelled.");
  };

  const handleUpsertPolicy = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (policyBusyId !== null) {
      return;
    }

    const toolPathPattern = policyPattern.trim();
    if (toolPathPattern.length === 0) {
      setPolicyStatusText("Tool path pattern is required.");
      return;
    }

    const policyId = policyEditingId ?? (createLocalId("pol_") as PolicyId);
    const nextPolicies = optimisticUpsertPolicy(policyItems, {
      workspaceId,
      policyId,
      toolPathPattern,
      decision: policyDecision,
    });

    setPolicyBusyId(policyId);
    setOptimisticPolicies(nextPolicies);

    void runUpsertPolicy({
      path: { workspaceId },
      payload: toPolicyUpsertPayload({
        id: policyEditingId ?? undefined,
        toolPathPattern,
        decision: policyDecision,
      }),
    })
      .then(() => {
        setPolicyStatusText(
          policyEditingId
            ? `Updated policy ${toolPathPattern}.`
            : `Added policy ${toolPathPattern}.`,
        );
        setPolicyEditingId(null);
        setPolicyPattern("");
        setPolicyDecision("require_approval");
        setOptimisticPolicies(null);
        refreshPolicies();
      })
      .catch(() => {
        setPolicyStatusText("Policy save failed.");
        setOptimisticPolicies(null);
        refreshPolicies();
      })
      .finally(() => {
        setPolicyBusyId(null);
      });
  };

  const handleRemovePolicy = (policyId: PolicyId) => {
    if (policyBusyId !== null) {
      return;
    }

    const nextPolicies = optimisticRemovePolicy(policyItems, policyId);
    setPolicyBusyId(policyId);
    setOptimisticPolicies(nextPolicies);

    void runRemovePolicy({
      path: { workspaceId, policyId },
    })
      .then((result) => {
        const removed = toPolicyRemoveResult(result);
        setPolicyStatusText(removed ? "Policy removed." : "Policy not found.");
        if (policyEditingId === policyId) {
          setPolicyEditingId(null);
          setPolicyPattern("");
          setPolicyDecision("require_approval");
        }
        setOptimisticPolicies(null);
        refreshPolicies();
      })
      .catch(() => {
        setPolicyStatusText("Policy removal failed.");
        setOptimisticPolicies(null);
        refreshPolicies();
      })
      .finally(() => {
        setPolicyBusyId(null);
      });
  };

  const handleOpenStorage = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (storageBusyId !== null) {
      return;
    }

    const purpose = storagePurposeInput.trim();
    const accountId = storageAccountIdInput.trim();
    const ttlHours = Number.parseInt(storageTtlHoursInput, 10);

    if (storageScopeType === "account" && accountId.length === 0) {
      setStorageStatusText("Account scope storage requires account id.");
      return;
    }

    if (
      storageDurability === "ephemeral"
      && (!Number.isFinite(ttlHours) || ttlHours <= 0)
    ) {
      setStorageStatusText("Ephemeral storage requires a positive TTL in hours.");
      return;
    }

    setStorageBusyId("create");

    void runOpenStorageInstance({
      path: { workspaceId },
      payload: toOpenStoragePayload({
        scopeType: storageScopeType,
        durability: storageDurability,
        provider: storageProvider,
        purpose: purpose.length > 0 ? purpose : undefined,
        ttlHours: storageDurability === "ephemeral" ? ttlHours : undefined,
        accountId:
          storageScopeType === "account"
            ? (accountId as Exclude<StorageInstance["accountId"], null>)
            : undefined,
      }),
    })
      .then((storageInstance) => {
        setStorageStatusText(`Opened storage instance ${storageInstance.id}.`);
        setStoragePurposeInput("");
        setStorageAccountIdInput("");
        setStorageSelectedId(storageInstance.id);
        refreshStorage();
      })
      .catch(() => {
        setStorageStatusText("Storage open failed.");
        refreshStorage();
      })
      .finally(() => {
        setStorageBusyId(null);
      });
  };

  const handleCloseStorage = (storageInstanceId: StorageInstance["id"]) => {
    if (storageBusyId !== null) {
      return;
    }

    setStorageBusyId(storageInstanceId);

    void runCloseStorageInstance({
      path: {
        workspaceId,
        storageInstanceId,
      },
    })
      .then(() => {
        setStorageStatusText("Storage instance closed.");
        refreshStorage();
      })
      .catch(() => {
        setStorageStatusText("Storage close failed.");
        refreshStorage();
      })
      .finally(() => {
        setStorageBusyId(null);
      });
  };

  const handleRemoveStorage = (storageInstanceId: StorageInstance["id"]) => {
    if (storageBusyId !== null) {
      return;
    }

    setStorageBusyId(storageInstanceId);

    void runRemoveStorageInstance({
      path: {
        workspaceId,
        storageInstanceId,
      },
    })
      .then((result) => {
        const removed = toStorageRemoveResult(result);
        setStorageStatusText(
          removed ? "Storage instance removed." : "Storage instance not found.",
        );
        if (storageSelectedId === storageInstanceId) {
          setStorageSelectedId(null);
          setStorageDirectoryEntries([]);
          setStorageFilePreviewPath(null);
          setStorageFilePreviewContent("");
          setStorageKvItems([]);
          setStorageSqlResult(null);
        }
        refreshStorage();
      })
      .catch(() => {
        setStorageStatusText("Storage removal failed.");
        refreshStorage();
      })
      .finally(() => {
        setStorageBusyId(null);
      });
  };

  const handleListStorageDirectory = (nextPath?: string) => {
    if (selectedStorageInstance === null || storageDirectoryBusy) {
      return;
    }

    const pathValue = (nextPath ?? storageDirectoryPath).trim();
    const normalizedPath = pathValue.length > 0 ? pathValue : "/";

    setStorageDirectoryBusy(true);

    void runListStorageDirectory({
      path: {
        workspaceId,
        storageInstanceId: selectedStorageInstance.id,
      },
      payload: toListStorageDirectoryPayload({
        path: normalizedPath,
      }),
    })
      .then((result) => {
        const directory = toStorageDirectoryResult(result);
        setStorageDirectoryPath(directory.path);
        setStorageDirectoryEntries(directory.entries);
        setStorageStatusText(`Loaded directory ${directory.path}.`);
      })
      .catch(() => {
        setStorageStatusText("Directory listing failed.");
      })
      .finally(() => {
        setStorageDirectoryBusy(false);
      });
  };

  const handleReadStorageFile = (filePath: string) => {
    if (selectedStorageInstance === null || storageFilePreviewBusy) {
      return;
    }

    setStorageFilePreviewBusy(true);

    void runReadStorageFile({
      path: {
        workspaceId,
        storageInstanceId: selectedStorageInstance.id,
      },
      payload: toReadStorageFilePayload({
        path: filePath,
        encoding: "utf8",
      }),
    })
      .then((result) => {
        const fileResult = toStorageReadFileResult(result);
        setStorageFilePreviewPath(fileResult.path);
        setStorageFilePreviewContent(fileResult.content);
      })
      .catch(() => {
        setStorageStatusText("File read failed.");
      })
      .finally(() => {
        setStorageFilePreviewBusy(false);
      });
  };

  const handleListStorageKv = () => {
    if (selectedStorageInstance === null || storageKvBusy) {
      return;
    }

    const parsedLimit = Number.parseInt(storageKvLimit, 10);

    setStorageKvBusy(true);

    void runListStorageKv({
      path: {
        workspaceId,
        storageInstanceId: selectedStorageInstance.id,
      },
      payload: toListStorageKvPayload({
        prefix: storageKvPrefix.trim(),
        limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined,
      }),
    })
      .then((result) => {
        const kvResult = toStorageKvResult(result);
        setStorageKvItems(kvResult.items);
      })
      .catch(() => {
        setStorageStatusText("KV listing failed.");
      })
      .finally(() => {
        setStorageKvBusy(false);
      });
  };

  const handleQueryStorageSql = () => {
    if (selectedStorageInstance === null || storageSqlBusy) {
      return;
    }

    const sql = storageSqlText.trim();
    const maxRows = Number.parseInt(storageSqlMaxRows, 10);

    if (sql.length === 0) {
      setStorageStatusText("SQL query is required.");
      return;
    }

    setStorageSqlBusy(true);

    void runQueryStorageSql({
      path: {
        workspaceId,
        storageInstanceId: selectedStorageInstance.id,
      },
      payload: toQueryStorageSqlPayload({
        sql,
        maxRows: Number.isFinite(maxRows) ? maxRows : undefined,
      }),
    })
      .then((result) => {
        const sqlResult = toStorageSqlResult(result);
        setStorageSqlResult(sqlResult);
      })
      .catch(() => {
        setStorageStatusText("SQL query failed.");
      })
      .finally(() => {
        setStorageSqlBusy(false);
      });
  };

  const handleSelectStorageInstance = (storageInstanceId: StorageInstance["id"]) => {
    setStorageSelectedId(storageInstanceId);
    setStorageDirectoryPath("/");
    setStorageDirectoryEntries([]);
    setStorageFilePreviewPath(null);
    setStorageFilePreviewContent("");
    setStorageKvItems([]);
    setStorageSqlResult(null);
  };

  const handleResolveApproval = (approvalId: ApprovalId, status: "approved" | "denied") => {
    if (approvalBusyId !== null) {
      return;
    }

    setApprovalBusyId(approvalId);

    const nextOptimistic = optimisticResolveApproval(approvalItems, {
      approvalId,
      payload: {
        status,
        reason: null,
      },
    });

    setOptimisticApprovals(nextOptimistic);

    void runResolveApproval({
      path: {
        workspaceId,
        approvalId,
      },
      payload: {
        status,
        reason: null,
      },
    })
      .then(() => {
        setApprovalStatusText(
          status === "approved" ? "Approval granted." : "Approval denied.",
        );
        setOptimisticApprovals(null);
        refreshApprovals();
      })
      .catch(() => {
        setApprovalStatusText("Approval update failed.");
        setOptimisticApprovals(null);
        refreshApprovals();
      })
      .finally(() => {
        setApprovalBusyId(null);
      });
  };

  return (
    <main className="min-h-screen py-8 sm:py-10">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
        <Card className="overflow-hidden border-border/70 bg-card/95 backdrop-blur-sm">
          <CardHeader className="space-y-4 border-b border-dashed border-border/80 pb-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-2">
                <CardTitle className="text-2xl sm:text-3xl">Executor v2 Console</CardTitle>
                <CardDescription>
                  Migrated legacy control workflows onto the v2 control-plane APIs.
                </CardDescription>
              </div>
              {authEnabled ? (
                <a
                  href="/sign-out"
                  className="inline-flex h-8 items-center justify-center rounded-md border border-input bg-background px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  Sign out
                </a>
              ) : null}
            </div>

            <div className="grid gap-2 sm:max-w-sm">
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground" htmlFor="workspace-id">
                Workspace
              </label>
              <Input
                id="workspace-id"
                value={workspaceIdInput}
                onChange={(event) => handleWorkspaceChange(event.target.value)}
                required
              />
            </div>

            <div className="flex flex-wrap gap-2" role="tablist" aria-label="Console tabs">
              <Button
                type="button"
                size="sm"
                variant={activeTab === "sources" ? "default" : "secondary"}
                onClick={() => setActiveTab("sources")}
                role="tab"
                aria-selected={activeTab === "sources"}
              >
                Sources
              </Button>
              <Button
                type="button"
                size="sm"
                variant={activeTab === "tools" ? "default" : "secondary"}
                onClick={() => setActiveTab("tools")}
                role="tab"
                aria-selected={activeTab === "tools"}
              >
                Tools
              </Button>
              <Button
                type="button"
                size="sm"
                variant={activeTab === "credentials" ? "default" : "secondary"}
                onClick={() => setActiveTab("credentials")}
                role="tab"
                aria-selected={activeTab === "credentials"}
              >
                Credentials
              </Button>
              <Button
                type="button"
                size="sm"
                variant={activeTab === "policies" ? "default" : "secondary"}
                onClick={() => setActiveTab("policies")}
                role="tab"
                aria-selected={activeTab === "policies"}
              >
                Policies
              </Button>
              <Button
                type="button"
                size="sm"
                variant={activeTab === "organizations" ? "default" : "secondary"}
                onClick={() => setActiveTab("organizations")}
                role="tab"
                aria-selected={activeTab === "organizations"}
              >
                Organizations
              </Button>
              <Button
                type="button"
                size="sm"
                variant={activeTab === "workspaces" ? "default" : "secondary"}
                onClick={() => setActiveTab("workspaces")}
                role="tab"
                aria-selected={activeTab === "workspaces"}
              >
                Workspaces
              </Button>
              <Button
                type="button"
                size="sm"
                variant={activeTab === "storage" ? "default" : "secondary"}
                onClick={() => setActiveTab("storage")}
                role="tab"
                aria-selected={activeTab === "storage"}
              >
                Storage
              </Button>
              <Button
                type="button"
                size="sm"
                variant={activeTab === "approvals" ? "default" : "secondary"}
                onClick={() => setActiveTab("approvals")}
                role="tab"
                aria-selected={activeTab === "approvals"}
                className="gap-2"
              >
                Approvals
                {pendingApprovalCount > 0 ? (
                  <span className="inline-flex min-w-[1.2rem] items-center justify-center rounded-full bg-background/20 px-1 text-[10px]">
                    {pendingApprovalCount}
                  </span>
                ) : null}
              </Button>
            </div>
          </CardHeader>

          <CardContent className="pt-6">
            {activeTab === "sources" ? (
              <div className="grid gap-5 lg:grid-cols-2">
                <Card className="border-border/70">
                  <CardHeader className="pb-3">
                    <CardTitle>{isEditing ? "Edit Source" : "Add Source"}</CardTitle>
                    <CardDescription>
                      Manage endpoints, transport, and auth wiring in one place.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-2 sm:grid-cols-2">
                      {catalogTemplates.map((template) => (
                        <Button
                          key={template.name}
                          type="button"
                          variant="outline"
                          size="sm"
                          className="justify-start"
                          onClick={() => handleTemplateUse(template)}
                        >
                          {template.name}
                        </Button>
                      ))}
                    </div>

                    <form className="space-y-3" onSubmit={handleUpsertSource}>
                      <div className="grid gap-1.5">
                        <label className="text-xs text-muted-foreground" htmlFor="source-name">Name</label>
                        <Input
                          id="source-name"
                          value={formState.name}
                          onChange={(event) => setFormField("name", event.target.value)}
                          required
                        />
                      </div>

                      <div className="grid gap-1.5">
                        <label className="text-xs text-muted-foreground" htmlFor="source-kind">Kind</label>
                        <Select
                          id="source-kind"
                          value={formState.type}
                          onChange={(event) =>
                            setFormField("type", event.target.value as LegacySourceType)
                          }
                        >
                          {kindOptions.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </Select>
                      </div>

                      <div className="grid gap-1.5">
                        <label className="text-xs text-muted-foreground" htmlFor="source-endpoint">Endpoint</label>
                        <Input
                          id="source-endpoint"
                          value={formState.endpoint}
                          onChange={(event) => setFormField("endpoint", event.target.value)}
                          placeholder="https://api.example.com/openapi.json"
                          required
                        />
                      </div>

                      {formState.type === "openapi" ? (
                        <div className="grid gap-1.5">
                          <label className="text-xs text-muted-foreground" htmlFor="source-base-url">Base URL</label>
                          <Input
                            id="source-base-url"
                            value={formState.baseUrl}
                            onChange={(event) => setFormField("baseUrl", event.target.value)}
                            placeholder="https://api.example.com"
                          />
                        </div>
                      ) : null}

                      {formState.type === "mcp" ? (
                        <div className="grid gap-1.5">
                          <label className="text-xs text-muted-foreground" htmlFor="source-transport">MCP Transport</label>
                          <Select
                            id="source-transport"
                            value={formState.mcpTransport}
                            onChange={(event) =>
                              setFormField(
                                "mcpTransport",
                                event.target.value as "auto" | "streamable-http" | "sse",
                              )
                            }
                          >
                            <option value="auto">auto</option>
                            <option value="streamable-http">streamable-http</option>
                            <option value="sse">sse</option>
                          </Select>
                        </div>
                      ) : null}

                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="grid gap-1.5">
                          <label className="text-xs text-muted-foreground" htmlFor="source-auth-type">Auth Type</label>
                          <Select
                            id="source-auth-type"
                            value={formState.authType}
                            onChange={(event) =>
                              setFormField(
                                "authType",
                                event.target.value as "none" | "bearer" | "apiKey" | "basic",
                              )
                            }
                          >
                            <option value="none">none</option>
                            <option value="bearer">bearer</option>
                            <option value="apiKey">apiKey</option>
                            <option value="basic">basic</option>
                          </Select>
                        </div>

                        <div className="grid gap-1.5">
                          <label className="text-xs text-muted-foreground" htmlFor="source-auth-mode">Auth Scope</label>
                          <Select
                            id="source-auth-mode"
                            value={formState.authMode}
                            onChange={(event) =>
                              setFormField(
                                "authMode",
                                event.target.value as "workspace" | "organization" | "account",
                              )
                            }
                          >
                            <option value="workspace">workspace</option>
                            <option value="organization">organization</option>
                            <option value="account">account</option>
                          </Select>
                        </div>
                      </div>

                      {formState.authType === "apiKey" ? (
                        <div className="grid gap-1.5">
                          <label className="text-xs text-muted-foreground" htmlFor="source-auth-header">API Key Header</label>
                          <Input
                            id="source-auth-header"
                            value={formState.apiKeyHeader}
                            onChange={(event) => setFormField("apiKeyHeader", event.target.value)}
                            placeholder="Authorization"
                          />
                        </div>
                      ) : null}

                      <div className="flex items-center justify-between rounded-md border border-border bg-muted/35 px-3 py-2">
                        <label htmlFor="source-enabled" className="text-xs font-medium">Enabled</label>
                        <input
                          id="source-enabled"
                          checked={formState.enabled}
                          onChange={(event) => setFormField("enabled", event.target.checked)}
                          type="checkbox"
                          className="h-4 w-4 rounded border-input bg-background text-primary"
                        />
                      </div>

                      <div className="grid gap-2 sm:grid-cols-2">
                        <Button type="submit" disabled={sourcesPending}>
                          {sourcesPending
                            ? "Saving..."
                            : isEditing
                              ? "Save Source"
                              : "Add Source"}
                        </Button>
                        {isEditing ? (
                          <Button
                            type="button"
                            variant="outline"
                            onClick={handleCancelEdit}
                            disabled={sourcesPending}
                          >
                            Cancel
                          </Button>
                        ) : null}
                      </div>
                    </form>

                    {statusText ? (
                      <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                        {statusText}
                      </div>
                    ) : null}
                  </CardContent>
                </Card>

                <Card className="border-border/70">
                  <CardHeader className="pb-3">
                    <CardTitle>Sources</CardTitle>
                    <CardDescription>Review existing sources and update quickly.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-1.5">
                      <label className="text-xs text-muted-foreground" htmlFor="source-search">Search</label>
                      <Input
                        id="source-search"
                        value={searchQuery}
                        onChange={(event) => setSearchQuery(event.target.value)}
                        placeholder="Search by name, kind, endpoint"
                      />
                    </div>

                    {sources.state === "loading" ? (
                      <div className="rounded-md border border-border bg-muted/35 px-3 py-2 text-sm text-muted-foreground">
                        Loading sources...
                      </div>
                    ) : null}

                    {sources.state === "error" ? (
                      <div className="rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                        {sources.message}
                      </div>
                    ) : null}

                    {sources.state !== "loading" && filteredSourceItems.length === 0 ? (
                      <div className="rounded-md border border-border bg-muted/35 px-3 py-2 text-sm text-muted-foreground">
                        {sourceItems.length === 0
                          ? "No sources yet in this workspace."
                          : "No sources match your search."}
                      </div>
                    ) : null}

                    <div className="space-y-2">
                      {filteredSourceItems.map((source) => (
                        <div
                          key={source.id}
                          className="rounded-lg border border-border bg-background/70 p-3"
                        >
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0 space-y-1">
                              <p className="truncate text-sm font-medium">{source.name}</p>
                              <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                                <Badge variant="outline">{source.type}</Badge>
                                <span>{source.status}</span>
                                <span>{source.enabled ? "enabled" : "disabled"}</span>
                              </div>
                              <p className="break-all text-xs text-muted-foreground">
                                {source.endpoint}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => handleEdit(source.id)}
                                disabled={sourcesPending}
                              >
                                Edit
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="destructive"
                                onClick={() => handleRemoveSource(source.id)}
                                disabled={sourcesPending}
                              >
                                Remove
                              </Button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            ) : null}

            {activeTab === "tools" ? (
              <div className="space-y-5">
                <Card className="border-border/70">
                  <CardHeader className="pb-3">
                    <CardTitle>Source Tools</CardTitle>
                    <CardDescription>
                      Inspect extracted tools for each source in the current workspace.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="grid gap-1.5">
                        <label className="text-xs text-muted-foreground" htmlFor="tools-source-filter">
                          Source filter
                        </label>
                        <Select
                          id="tools-source-filter"
                          value={selectedToolSourceId}
                          onChange={(event) =>
                            setSelectedToolSourceId(event.target.value as SourceId | "all")
                          }
                        >
                          <option value="all">All sources</option>
                          {sourceItems.map((source) => (
                            <option key={source.id} value={source.id}>
                              {source.name}
                            </option>
                          ))}
                        </Select>
                      </div>
                      <div className="grid gap-1.5">
                        <label className="text-xs text-muted-foreground" htmlFor="tools-search">
                          Search
                        </label>
                        <Input
                          id="tools-search"
                          value={toolSearchQuery}
                          onChange={(event) => setToolSearchQuery(event.target.value)}
                          placeholder="Search tool id, name, path"
                        />
                      </div>
                    </div>

                    <div className="flex justify-end">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          void handleRefreshTools();
                        }}
                        disabled={sourcesPending || toolsRefreshPending}
                      >
                        {toolsRefreshPending ? "Refreshing..." : "Refresh tools"}
                      </Button>
                    </div>

                    {workspaceTools.state === "loading" ? (
                      <div className="rounded-md border border-border bg-muted/35 px-3 py-2 text-sm text-muted-foreground">
                        Loading tools...
                      </div>
                    ) : null}

                    {workspaceTools.state === "error" ? (
                      <div className="rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                        {workspaceTools.message}
                      </div>
                    ) : null}

                    {workspaceTools.state !== "loading" && filteredToolItems.length === 0 ? (
                      <div className="rounded-md border border-border bg-muted/35 px-3 py-2 text-sm text-muted-foreground">
                        No tools found for this workspace/source filter.
                      </div>
                    ) : null}

                    <div className="space-y-2">
                      {filteredToolItems.map((tool) => (
                        <div key={`${tool.sourceId}:${tool.toolId}`} className="rounded-lg border border-border bg-background/70 p-3">
                          <div className="space-y-1">
                            <p className="text-sm font-medium">{tool.name}</p>
                            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                              <Badge variant="outline">{tool.sourceName}</Badge>
                              <Badge variant="outline">{tool.method.toUpperCase()}</Badge>
                              <span className="break-all">{tool.path}</span>
                            </div>
                            <p className="break-all text-xs text-muted-foreground">{tool.toolId}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            ) : null}

            {activeTab === "credentials" ? (
              <div className="grid gap-5 lg:grid-cols-2">
                <Card className="border-border/70">
                  <CardHeader className="pb-3">
                    <CardTitle>{credentialEditingId ? "Edit Credential Binding" : "Add Credential Binding"}</CardTitle>
                    <CardDescription>
                      Bind workspace credentials to sources and providers.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <form className="space-y-3" onSubmit={handleUpsertCredential}>
                      <div className="grid gap-1.5">
                        <label className="text-xs text-muted-foreground" htmlFor="credential-source-key">Source key</label>
                        <Input
                          id="credential-source-key"
                          value={credentialSourceKey}
                          onChange={(event) => setCredentialSourceKey(event.target.value)}
                          placeholder="source_github"
                          required
                        />
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="grid gap-1.5">
                          <label className="text-xs text-muted-foreground" htmlFor="credential-provider">Provider</label>
                          <Select
                            id="credential-provider"
                            value={credentialProvider}
                            onChange={(event) =>
                              setCredentialProvider(event.target.value as CredentialProvider)
                            }
                          >
                            <option value="api_key">api_key</option>
                            <option value="bearer">bearer</option>
                            <option value="oauth2">oauth2</option>
                            <option value="custom">custom</option>
                          </Select>
                        </div>

                        <div className="grid gap-1.5">
                          <label className="text-xs text-muted-foreground" htmlFor="credential-scope-type">Scope</label>
                          <Select
                            id="credential-scope-type"
                            value={credentialScopeType}
                            onChange={(event) =>
                              setCredentialScopeType(event.target.value as CredentialScopeType)
                            }
                          >
                            <option value="workspace">workspace</option>
                            <option value="organization">organization</option>
                            <option value="account">account</option>
                          </Select>
                        </div>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="grid gap-1.5">
                          <label className="text-xs text-muted-foreground" htmlFor="credential-id">Credential id</label>
                          <Input
                            id="credential-id"
                            value={credentialIdInput}
                            onChange={(event) => setCredentialIdInput(event.target.value)}
                            placeholder="cred_123"
                            required
                          />
                        </div>

                        <div className="grid gap-1.5">
                          <label className="text-xs text-muted-foreground" htmlFor="credential-secret-ref">Secret ref</label>
                          <Input
                            id="credential-secret-ref"
                            value={credentialSecretRef}
                            onChange={(event) => setCredentialSecretRef(event.target.value)}
                            placeholder="secrets/github-token"
                            required
                          />
                        </div>
                      </div>

                      {credentialScopeType === "account" ? (
                        <div className="grid gap-1.5">
                          <label className="text-xs text-muted-foreground" htmlFor="credential-account-id">Account id</label>
                          <Input
                            id="credential-account-id"
                            value={credentialAccountId}
                            onChange={(event) => setCredentialAccountId(event.target.value)}
                            placeholder="acct_123"
                            required
                          />
                        </div>
                      ) : null}

                      <div className="grid gap-1.5">
                        <label className="text-xs text-muted-foreground" htmlFor="credential-headers-json">Additional headers JSON (optional)</label>
                        <Input
                          id="credential-headers-json"
                          value={credentialAdditionalHeadersJson}
                          onChange={(event) => setCredentialAdditionalHeadersJson(event.target.value)}
                          placeholder='{"X-Team": "tools"}'
                        />
                      </div>

                      <div className="grid gap-1.5">
                        <label className="text-xs text-muted-foreground" htmlFor="credential-auth-fingerprint">Bound auth fingerprint (optional)</label>
                        <Input
                          id="credential-auth-fingerprint"
                          value={credentialBoundAuthFingerprint}
                          onChange={(event) => setCredentialBoundAuthFingerprint(event.target.value)}
                          placeholder="fingerprint hash"
                        />
                      </div>

                      <div className="grid gap-2 sm:grid-cols-2">
                        <Button type="submit" disabled={credentialBusyId !== null}>
                          {credentialBusyId !== null
                            ? "Saving..."
                            : credentialEditingId
                              ? "Save Binding"
                              : "Add Binding"}
                        </Button>
                        {credentialEditingId ? (
                          <Button
                            type="button"
                            variant="outline"
                            onClick={handleCancelCredentialEdit}
                            disabled={credentialBusyId !== null}
                          >
                            Cancel
                          </Button>
                        ) : null}
                      </div>
                    </form>

                    {credentialStatusText ? (
                      <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                        {credentialStatusText}
                      </div>
                    ) : null}
                  </CardContent>
                </Card>

                <Card className="border-border/70">
                  <CardHeader className="pb-3">
                    <CardTitle>Credential Bindings</CardTitle>
                    <CardDescription>Credentials currently linked to sources.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-1.5">
                      <label className="text-xs text-muted-foreground" htmlFor="credential-search">Search</label>
                      <Input
                        id="credential-search"
                        value={credentialSearchQuery}
                        onChange={(event) => setCredentialSearchQuery(event.target.value)}
                        placeholder="source key, provider, scope, secret"
                      />
                    </div>

                    {credentialBindingsState.state === "loading" ? (
                      <div className="rounded-md border border-border bg-muted/35 px-3 py-2 text-sm text-muted-foreground">
                        Loading credential bindings...
                      </div>
                    ) : null}

                    {credentialBindingsState.state === "error" ? (
                      <div className="rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                        {credentialBindingsState.message}
                      </div>
                    ) : null}

                    {credentialBindingsState.state !== "loading" && filteredCredentials.length === 0 ? (
                      <div className="rounded-md border border-border bg-muted/35 px-3 py-2 text-sm text-muted-foreground">
                        No credential bindings found.
                      </div>
                    ) : null}

                    <div className="space-y-2">
                      {filteredCredentials.map((binding) => {
                        const isBusy = credentialBusyId === binding.id;

                        return (
                          <div
                            key={binding.id}
                            className={cn(
                              "rounded-lg border border-border bg-background/70 p-3",
                              isBusy && "opacity-80",
                            )}
                          >
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                              <div className="min-w-0 space-y-1">
                                <p className="truncate text-sm font-medium">{binding.sourceKey}</p>
                                <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                                  <Badge variant="outline">{binding.provider}</Badge>
                                  <Badge variant="outline">{binding.scopeType}</Badge>
                                  <span>{binding.credentialId}</span>
                                </div>
                                <p className="break-all text-xs text-muted-foreground">
                                  secret {binding.secretRef}
                                </p>
                                {binding.accountId ? (
                                  <p className="break-all text-xs text-muted-foreground">
                                    account {binding.accountId}
                                  </p>
                                ) : null}
                              </div>

                              <div className="flex items-center gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleEditCredential(binding.id)}
                                  disabled={credentialBusyId !== null}
                                >
                                  Edit
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="destructive"
                                  onClick={() => handleRemoveCredential(binding.id)}
                                  disabled={credentialBusyId !== null}
                                >
                                  {isBusy ? "Working..." : "Remove"}
                                </Button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              </div>
            ) : null}

            {activeTab === "policies" ? (
              <Card className="border-border/70">
                <CardHeader className="pb-3">
                  <CardTitle>Policies</CardTitle>
                  <CardDescription>
                    Define default allow/deny/approval behavior by tool path pattern.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <form className="space-y-3" onSubmit={handleUpsertPolicy}>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="grid gap-1.5 sm:col-span-2">
                        <label className="text-xs text-muted-foreground" htmlFor="policy-pattern">Tool path pattern</label>
                        <Input
                          id="policy-pattern"
                          value={policyPattern}
                          onChange={(event) => setPolicyPattern(event.target.value)}
                          placeholder="source:* or source:github/*"
                          required
                        />
                      </div>

                      <div className="grid gap-1.5">
                        <label className="text-xs text-muted-foreground" htmlFor="policy-decision">Decision</label>
                        <Select
                          id="policy-decision"
                          value={policyDecision}
                          onChange={(event) =>
                            setPolicyDecision(event.target.value as PolicyDecision)
                          }
                        >
                          <option value="allow">allow</option>
                          <option value="require_approval">require_approval</option>
                          <option value="deny">deny</option>
                        </Select>
                      </div>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2">
                      <Button type="submit" disabled={policyBusyId !== null}>
                        {policyBusyId !== null
                          ? "Saving..."
                          : policyEditingId
                            ? "Save Policy"
                            : "Add Policy"}
                      </Button>

                      {policyEditingId ? (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={handleCancelPolicyEdit}
                          disabled={policyBusyId !== null}
                        >
                          Cancel
                        </Button>
                      ) : null}
                    </div>
                  </form>

                  {policyStatusText ? (
                    <div className="rounded-md border border-border bg-muted/35 px-3 py-2 text-sm text-muted-foreground">
                      {policyStatusText}
                    </div>
                  ) : null}

                  <div className="grid gap-1.5">
                    <label className="text-xs text-muted-foreground" htmlFor="policy-search">Search</label>
                    <Input
                      id="policy-search"
                      value={policySearchQuery}
                      onChange={(event) => setPolicySearchQuery(event.target.value)}
                      placeholder="pattern or decision"
                    />
                  </div>

                  {policiesState.state === "loading" ? (
                    <div className="rounded-md border border-border bg-muted/35 px-3 py-2 text-sm text-muted-foreground">
                      Loading policies...
                    </div>
                  ) : null}

                  {policiesState.state === "error" ? (
                    <div className="rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                      {policiesState.message}
                    </div>
                  ) : null}

                  {policiesState.state !== "loading" && filteredPolicies.length === 0 ? (
                    <div className="rounded-md border border-border bg-muted/35 px-3 py-2 text-sm text-muted-foreground">
                      No policies configured.
                    </div>
                  ) : null}

                  <div className="space-y-2">
                    {filteredPolicies.map((policy) => (
                      <div
                        key={policy.id}
                        className="rounded-lg border border-border bg-background/70 p-3"
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0 space-y-1">
                            <p className="break-all text-sm font-medium">{policy.toolPathPattern}</p>
                            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                              <Badge variant="outline">{policy.decision}</Badge>
                              <span>updated {formatTimestamp(policy.updatedAt)}</span>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => handleEditPolicy(policy.id)}
                              disabled={policyBusyId !== null}
                            >
                              Edit
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="destructive"
                              onClick={() => handleRemovePolicy(policy.id)}
                              disabled={policyBusyId !== null}
                            >
                              Remove
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ) : null}

            {activeTab === "organizations" ? (
              <div className="grid gap-5 lg:grid-cols-2">
                <Card className="border-border/70">
                  <CardHeader className="pb-3">
                    <CardTitle>Organization Profile</CardTitle>
                    <CardDescription>
                      Create or update organization records used by workspaces.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <form className="space-y-3" onSubmit={handleUpsertOrganization}>
                      <div className="grid gap-1.5">
                        <label className="text-xs text-muted-foreground" htmlFor="organization-id">ID (optional)</label>
                        <Input
                          id="organization-id"
                          value={organizationIdInput}
                          onChange={(event) => setOrganizationIdInput(event.target.value)}
                          placeholder="org_local"
                        />
                      </div>
                      <div className="grid gap-1.5">
                        <label className="text-xs text-muted-foreground" htmlFor="organization-slug">Slug</label>
                        <Input
                          id="organization-slug"
                          value={organizationSlugInput}
                          onChange={(event) => setOrganizationSlugInput(event.target.value)}
                          placeholder="acme"
                          required
                        />
                      </div>
                      <div className="grid gap-1.5">
                        <label className="text-xs text-muted-foreground" htmlFor="organization-name">Name</label>
                        <Input
                          id="organization-name"
                          value={organizationNameInput}
                          onChange={(event) => setOrganizationNameInput(event.target.value)}
                          placeholder="Acme"
                          required
                        />
                      </div>
                      <div className="grid gap-1.5">
                        <label className="text-xs text-muted-foreground" htmlFor="organization-status">Status</label>
                        <Select
                          id="organization-status"
                          value={organizationStatusInput}
                          onChange={(event) =>
                            setOrganizationStatusInput(event.target.value as Organization["status"])
                          }
                        >
                          <option value="active">active</option>
                          <option value="suspended">suspended</option>
                          <option value="archived">archived</option>
                        </Select>
                      </div>
                      <div className="flex gap-2">
                        <Button type="submit">Save Organization</Button>
                        <Button type="button" variant="outline" onClick={() => refreshOrganizations()}>
                          Refresh
                        </Button>
                      </div>
                    </form>
                    {organizationStatusText ? (
                      <div className="rounded-md border border-border bg-muted/35 px-3 py-2 text-sm text-muted-foreground">
                        {organizationStatusText}
                      </div>
                    ) : null}
                  </CardContent>
                </Card>

                <Card className="border-border/70">
                  <CardHeader className="pb-3">
                    <CardTitle>Organizations</CardTitle>
                    <CardDescription>Available organizations from the control plane.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {organizations.state === "loading" ? (
                      <div className="rounded-md border border-border bg-muted/35 px-3 py-2 text-sm text-muted-foreground">
                        Loading organizations...
                      </div>
                    ) : null}
                    {organizations.state === "error" ? (
                      <div className="rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                        {organizations.message}
                      </div>
                    ) : null}
                    {organizations.state !== "loading" && organizations.items.length === 0 ? (
                      <div className="rounded-md border border-border bg-muted/35 px-3 py-2 text-sm text-muted-foreground">
                        No organizations yet.
                      </div>
                    ) : null}
                    {organizations.items.map((organization) => (
                      <div key={organization.id} className="rounded-lg border border-border bg-background/70 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="space-y-1">
                            <p className="text-sm font-medium">{organization.name}</p>
                            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                              <Badge variant="outline">{organization.status}</Badge>
                              <span>{organization.slug}</span>
                              <span>{organization.id}</span>
                            </div>
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => handleLoadOrganization(organization)}
                          >
                            Load
                          </Button>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>
            ) : null}

            {activeTab === "workspaces" ? (
              <div className="grid gap-5 lg:grid-cols-2">
                <Card className="border-border/70">
                  <CardHeader className="pb-3">
                    <CardTitle>Workspace Profile</CardTitle>
                    <CardDescription>Create or update workspace records.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <form className="space-y-3" onSubmit={handleUpsertWorkspace}>
                      <div className="grid gap-1.5">
                        <label className="text-xs text-muted-foreground" htmlFor="workspace-edit-id">ID (optional)</label>
                        <Input
                          id="workspace-edit-id"
                          value={workspaceEditIdInput}
                          onChange={(event) => setWorkspaceEditIdInput(event.target.value)}
                          placeholder="ws_local"
                        />
                      </div>
                      <div className="grid gap-1.5">
                        <label className="text-xs text-muted-foreground" htmlFor="workspace-name">Name</label>
                        <Input
                          id="workspace-name"
                          value={workspaceNameInput}
                          onChange={(event) => setWorkspaceNameInput(event.target.value)}
                          placeholder="Local Workspace"
                          required
                        />
                      </div>
                      <div className="grid gap-1.5">
                        <label className="text-xs text-muted-foreground" htmlFor="workspace-organization-id">Organization ID</label>
                        <Input
                          id="workspace-organization-id"
                          value={workspaceOrganizationIdInput}
                          onChange={(event) =>
                            setWorkspaceOrganizationIdInput(event.target.value)
                          }
                          placeholder="org_local (optional)"
                        />
                      </div>
                      <div className="flex gap-2">
                        <Button type="submit">Save Workspace</Button>
                        <Button type="button" variant="outline" onClick={() => refreshWorkspaces()}>
                          Refresh
                        </Button>
                      </div>
                    </form>
                    {workspaceStatusText ? (
                      <div className="rounded-md border border-border bg-muted/35 px-3 py-2 text-sm text-muted-foreground">
                        {workspaceStatusText}
                      </div>
                    ) : null}
                  </CardContent>
                </Card>

                <Card className="border-border/70">
                  <CardHeader className="pb-3">
                    <CardTitle>Workspaces</CardTitle>
                    <CardDescription>Available workspaces from the control plane.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {workspaces.state === "loading" ? (
                      <div className="rounded-md border border-border bg-muted/35 px-3 py-2 text-sm text-muted-foreground">
                        Loading workspaces...
                      </div>
                    ) : null}
                    {workspaces.state === "error" ? (
                      <div className="rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                        {workspaces.message}
                      </div>
                    ) : null}
                    {workspaces.state !== "loading" && workspaces.items.length === 0 ? (
                      <div className="rounded-md border border-border bg-muted/35 px-3 py-2 text-sm text-muted-foreground">
                        No workspaces yet.
                      </div>
                    ) : null}
                    {workspaces.items.map((workspace) => (
                      <div key={workspace.id} className="rounded-lg border border-border bg-background/70 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="space-y-1">
                            <p className="text-sm font-medium">{workspace.name}</p>
                            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                              <span>{workspace.id}</span>
                              <span>org {workspace.organizationId ?? "-"}</span>
                            </div>
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => handleLoadWorkspace(workspace)}
                          >
                            Load
                          </Button>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>
            ) : null}

            {activeTab === "storage" ? (
              <div className="grid gap-5 lg:grid-cols-2">
                <Card className="border-border/70">
                  <CardHeader className="pb-3">
                    <CardTitle>Open Storage Instance</CardTitle>
                    <CardDescription>
                      Provision workspace storage for files, KV, and SQLite workloads.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <form className="space-y-3" onSubmit={handleOpenStorage}>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="grid gap-1.5">
                          <label className="text-xs text-muted-foreground" htmlFor="storage-scope">Scope</label>
                          <Select
                            id="storage-scope"
                            value={storageScopeType}
                            onChange={(event) =>
                              setStorageScopeType(event.target.value as StorageScopeType)
                            }
                          >
                            <option value="scratch">scratch</option>
                            <option value="workspace">workspace</option>
                            <option value="organization">organization</option>
                            <option value="account">account</option>
                          </Select>
                        </div>

                        <div className="grid gap-1.5">
                          <label className="text-xs text-muted-foreground" htmlFor="storage-durability">Durability</label>
                          <Select
                            id="storage-durability"
                            value={storageDurability}
                            onChange={(event) =>
                              setStorageDurability(event.target.value as StorageDurability)
                            }
                          >
                            <option value="ephemeral">ephemeral</option>
                            <option value="durable">durable</option>
                          </Select>
                        </div>
                      </div>

                      <div className="grid gap-1.5">
                        <label className="text-xs text-muted-foreground" htmlFor="storage-provider">Provider</label>
                        <Select
                          id="storage-provider"
                          value={storageProvider}
                          onChange={(event) =>
                            setStorageProvider(event.target.value as StorageInstance["provider"])
                          }
                        >
                          <option value="agentfs-local">agentfs-local</option>
                          <option value="agentfs-cloudflare">agentfs-cloudflare</option>
                        </Select>
                      </div>

                      <div className="grid gap-1.5">
                        <label className="text-xs text-muted-foreground" htmlFor="storage-purpose">Purpose (optional)</label>
                        <Input
                          id="storage-purpose"
                          value={storagePurposeInput}
                          onChange={(event) => setStoragePurposeInput(event.target.value)}
                          placeholder="tool execution workspace"
                        />
                      </div>

                      {storageDurability === "ephemeral" ? (
                        <div className="grid gap-1.5">
                          <label className="text-xs text-muted-foreground" htmlFor="storage-ttl-hours">TTL hours</label>
                          <Input
                            id="storage-ttl-hours"
                            value={storageTtlHoursInput}
                            onChange={(event) => setStorageTtlHoursInput(event.target.value)}
                            placeholder="24"
                            inputMode="numeric"
                          />
                        </div>
                      ) : null}

                      {storageScopeType === "account" ? (
                        <div className="grid gap-1.5">
                          <label className="text-xs text-muted-foreground" htmlFor="storage-account-id">Account id</label>
                          <Input
                            id="storage-account-id"
                            value={storageAccountIdInput}
                            onChange={(event) => setStorageAccountIdInput(event.target.value)}
                            placeholder="acct_123"
                            required
                          />
                        </div>
                      ) : null}

                      <Button type="submit" disabled={storageBusyId !== null}>
                        {storageBusyId === "create" ? "Opening..." : "Open Storage"}
                      </Button>
                    </form>

                    {storageStatusText ? (
                      <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                        {storageStatusText}
                      </div>
                    ) : null}
                  </CardContent>
                </Card>

                <Card className="border-border/70">
                  <CardHeader className="pb-3">
                    <CardTitle>Storage Instances</CardTitle>
                    <CardDescription>Inspect and manage workspace storage instances.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-1.5">
                      <label className="text-xs text-muted-foreground" htmlFor="storage-search">Search</label>
                      <Input
                        id="storage-search"
                        value={storageSearchQuery}
                        onChange={(event) => setStorageSearchQuery(event.target.value)}
                        placeholder="scope, durability, status, provider"
                      />
                    </div>

                    <div className="grid gap-1.5">
                      <label className="text-xs text-muted-foreground" htmlFor="storage-selected">Inspector target</label>
                      <Select
                        id="storage-selected"
                        value={selectedStorageInstance?.id ?? ""}
                        onChange={(event) =>
                          handleSelectStorageInstance(event.target.value as StorageInstance["id"])
                        }
                        disabled={storageItems.length === 0}
                      >
                        {storageItems.length === 0 ? (
                          <option value="">No storage instances</option>
                        ) : (
                          storageItems.map((storageInstance) => (
                            <option key={storageInstance.id} value={storageInstance.id}>
                              {storageInstance.id}
                            </option>
                          ))
                        )}
                      </Select>
                    </div>

                    {storageState.state === "loading" ? (
                      <div className="rounded-md border border-border bg-muted/35 px-3 py-2 text-sm text-muted-foreground">
                        Loading storage instances...
                      </div>
                    ) : null}

                    {storageState.state === "error" ? (
                      <div className="rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                        {storageState.message}
                      </div>
                    ) : null}

                    {storageState.state !== "loading" && filteredStorageItems.length === 0 ? (
                      <div className="rounded-md border border-border bg-muted/35 px-3 py-2 text-sm text-muted-foreground">
                        No storage instances found.
                      </div>
                    ) : null}

                    <div className="space-y-2">
                      {filteredStorageItems.map((storageInstance) => {
                        const busy = storageBusyId === storageInstance.id;

                        return (
                          <div
                            key={storageInstance.id}
                            className={cn(
                              "rounded-lg border border-border bg-background/70 p-3",
                              busy && "opacity-80",
                            )}
                          >
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                              <div className="min-w-0 space-y-1">
                                <p className="truncate text-sm font-medium">{storageInstance.id}</p>
                                <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                                  <Badge variant="outline">{storageInstance.scopeType}</Badge>
                                  <Badge variant="outline">{storageInstance.durability}</Badge>
                                  <Badge variant="outline">{storageInstance.status}</Badge>
                                  <span>{storageInstance.provider}</span>
                                </div>
                                <p className="break-all text-xs text-muted-foreground">
                                  backend {storageInstance.backendKey}
                                </p>
                                {storageInstance.purpose ? (
                                  <p className="break-all text-xs text-muted-foreground">
                                    purpose {storageInstance.purpose}
                                  </p>
                                ) : null}
                                <p className="break-all text-xs text-muted-foreground">
                                  updated {formatTimestamp(storageInstance.updatedAt)}
                                </p>
                              </div>

                              <div className="flex items-center gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleSelectStorageInstance(storageInstance.id)}
                                  disabled={storageBusyId !== null}
                                >
                                  Inspect
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleCloseStorage(storageInstance.id)}
                                  disabled={
                                    storageBusyId !== null || storageInstance.status !== "active"
                                  }
                                >
                                  Close
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="destructive"
                                  onClick={() => handleRemoveStorage(storageInstance.id)}
                                  disabled={storageBusyId !== null}
                                >
                                  {busy ? "Working..." : "Remove"}
                                </Button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {selectedStorageInstance ? (
                      <div className="space-y-4 rounded-lg border border-border bg-muted/20 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-medium">Inspector {selectedStorageInstance.id}</p>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => handleListStorageDirectory()}
                            disabled={storageDirectoryBusy}
                          >
                            {storageDirectoryBusy ? "Loading..." : "Load Directory"}
                          </Button>
                        </div>

                        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                          <Input
                            value={storageDirectoryPath}
                            onChange={(event) => setStorageDirectoryPath(event.target.value)}
                            placeholder="/"
                          />
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => handleListStorageDirectory()}
                            disabled={storageDirectoryBusy}
                          >
                            Open Path
                          </Button>
                        </div>

                        <div className="max-h-52 space-y-1 overflow-auto rounded-md border border-border bg-background/70 p-2">
                          {storageDirectoryEntries.length === 0 ? (
                            <p className="text-xs text-muted-foreground">No directory entries loaded.</p>
                          ) : (
                            storageDirectoryEntries.map((entry) => (
                              <div
                                key={`${entry.path}:${entry.kind}`}
                                className="flex items-center justify-between gap-2 rounded border border-border/60 px-2 py-1"
                              >
                                <div className="min-w-0">
                                  <p className="truncate text-xs font-medium">{entry.name}</p>
                                  <p className="truncate text-[11px] text-muted-foreground">{entry.path}</p>
                                </div>
                                {entry.kind === "file" ? (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleReadStorageFile(entry.path)}
                                    disabled={storageFilePreviewBusy}
                                  >
                                    Read
                                  </Button>
                                ) : (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleListStorageDirectory(entry.path)}
                                    disabled={storageDirectoryBusy}
                                  >
                                    Open
                                  </Button>
                                )}
                              </div>
                            ))
                          )}
                        </div>

                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">
                            File preview {storageFilePreviewPath ?? "-"}
                          </p>
                          <pre className="max-h-40 overflow-auto rounded-md border border-border bg-background/70 p-2 text-[11px] text-muted-foreground">
                            {storageFilePreviewContent.length > 0
                              ? storageFilePreviewContent
                              : "No file loaded."}
                          </pre>
                        </div>

                        <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
                          <Input
                            value={storageKvPrefix}
                            onChange={(event) => setStorageKvPrefix(event.target.value)}
                            placeholder="KV prefix"
                          />
                          <Input
                            value={storageKvLimit}
                            onChange={(event) => setStorageKvLimit(event.target.value)}
                            inputMode="numeric"
                            placeholder="100"
                          />
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={handleListStorageKv}
                            disabled={storageKvBusy}
                          >
                            {storageKvBusy ? "Loading..." : "Load KV"}
                          </Button>
                        </div>

                        <pre className="max-h-40 overflow-auto rounded-md border border-border bg-background/70 p-2 text-[11px] text-muted-foreground">
                          {JSON.stringify(storageKvItems, null, 2)}
                        </pre>

                        <div className="space-y-2">
                          <textarea
                            className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-xs"
                            value={storageSqlText}
                            onChange={(event) => setStorageSqlText(event.target.value)}
                          />
                          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                            <Input
                              value={storageSqlMaxRows}
                              onChange={(event) => setStorageSqlMaxRows(event.target.value)}
                              inputMode="numeric"
                              placeholder="200"
                            />
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={handleQueryStorageSql}
                              disabled={storageSqlBusy}
                            >
                              {storageSqlBusy ? "Running..." : "Run SQL"}
                            </Button>
                          </div>
                          <pre className="max-h-48 overflow-auto rounded-md border border-border bg-background/70 p-2 text-[11px] text-muted-foreground">
                            {JSON.stringify(storageSqlResult, null, 2)}
                          </pre>
                        </div>
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              </div>
            ) : null}

            {activeTab === "approvals" ? (
              <Card className="border-border/70">
                <CardHeader className="pb-3">
                  <CardTitle>Approvals</CardTitle>
                  <CardDescription>Review and resolve pending tool approvals.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="grid gap-1.5">
                      <label className="text-xs text-muted-foreground" htmlFor="approval-filter">Filter</label>
                      <Select
                        id="approval-filter"
                        value={approvalFilter}
                        onChange={(event) =>
                          setApprovalFilter(event.target.value as ApprovalFilter)
                        }
                      >
                        <option value="pending">pending</option>
                        <option value="resolved">resolved</option>
                        <option value="all">all</option>
                      </Select>
                    </div>

                    <div className="grid gap-1.5">
                      <label className="text-xs text-muted-foreground" htmlFor="approval-search">Search</label>
                      <Input
                        id="approval-search"
                        value={approvalSearchQuery}
                        onChange={(event) => setApprovalSearchQuery(event.target.value)}
                        placeholder="tool path, status, call id"
                      />
                    </div>
                  </div>

                  {approvalStatusText ? (
                    <div className="rounded-md border border-border bg-muted/35 px-3 py-2 text-sm text-muted-foreground">
                      {approvalStatusText}
                    </div>
                  ) : null}

                  {approvalsState.state === "loading" ? (
                    <div className="rounded-md border border-border bg-muted/35 px-3 py-2 text-sm text-muted-foreground">
                      Loading approvals...
                    </div>
                  ) : null}

                  {approvalsState.state === "error" ? (
                    <div className="rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                      {approvalsState.message}
                    </div>
                  ) : null}

                  {approvalsState.state !== "loading" && filteredApprovals.length === 0 ? (
                    <div className="rounded-md border border-border bg-muted/35 px-3 py-2 text-sm text-muted-foreground">
                      No approvals for this filter.
                    </div>
                  ) : null}

                  <div className="space-y-2">
                    {filteredApprovals.map((approval) => {
                      const busy = approvalBusyId === approval.id;
                      const canResolve = approval.status === "pending";

                      return (
                        <div
                          className={cn(
                            "rounded-lg border border-border bg-background/70 p-3",
                            busy && "opacity-80",
                          )}
                          key={approval.id}
                        >
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0 space-y-1">
                              <p className="break-all text-sm font-medium">{approval.toolPath}</p>
                              <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                                <Badge variant={statusBadgeVariant(approval.status)}>
                                  {approval.status}
                                </Badge>
                                <span>requested {formatTimestamp(approval.requestedAt)}</span>
                                <span>resolved {formatTimestamp(approval.resolvedAt)}</span>
                              </div>
                              <p className="break-all text-xs text-muted-foreground">task {approval.taskRunId}</p>
                              <p className="break-all text-xs text-muted-foreground">call {approval.callId}</p>
                              {approval.reason ? (
                                <p className="break-all text-xs text-muted-foreground">reason: {approval.reason}</p>
                              ) : null}
                            </div>

                            <div className="flex items-center gap-2">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => handleResolveApproval(approval.id, "approved")}
                                disabled={!canResolve || busy}
                              >
                                {busy && canResolve ? "Working..." : "Approve"}
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="destructive"
                                onClick={() => handleResolveApproval(approval.id, "denied")}
                                disabled={!canResolve || busy}
                              >
                                Deny
                              </Button>
                            </div>
                          </div>

                          <pre className="mt-3 max-h-56 overflow-auto rounded-md border border-border bg-muted/45 p-3 text-[11px] leading-5 text-muted-foreground">
                            {previewFromInputJson(approval.inputPreviewJson)}
                          </pre>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </main>
  );
};

export default Page;
