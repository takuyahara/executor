import {
  registerExecutorSdkPlugins,
  type ExecutorSdkPlugin,
} from "../../../plugins";

let configuredSourcePlugins: readonly ExecutorSdkPlugin[] = [];
let registry = registerExecutorSdkPlugins(configuredSourcePlugins);

const refreshRegistry = () => {
  registry = registerExecutorSdkPlugins(configuredSourcePlugins);
};

export const configureExecutorSourcePlugins = (
  plugins: readonly ExecutorSdkPlugin[],
): void => {
  configuredSourcePlugins = plugins;
  refreshRegistry();
};

export const registeredSourcePlugins = () => registry.sourcePlugins;
export const registeredSourceConnectors = () => registry.sourceConnectors;

export const getSourcePlugin = (kind: string) => registry.getSourcePlugin(kind);
export const getSourcePluginForSource = (
  source: Parameters<typeof registry.getSourcePluginForSource>[0],
) => registry.getSourcePluginForSource(source);
export const sourcePluginCatalogKind = (kind: string) =>
  registry.sourcePluginCatalogKind(kind);
export const isInternalSourcePluginKind = (kind: string) =>
  registry.isInternalSourcePluginKind(kind);

export const hasRegisteredExternalSourcePlugins = () =>
  configuredSourcePlugins.length > 0;
