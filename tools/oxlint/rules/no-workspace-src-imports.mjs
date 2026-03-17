import { defineRule } from "@oxlint/plugins";

import {
  createModuleSourceVisitor,
  getExecutorMonorepoSettings,
  readStaticSpecifier,
} from "../workspace-utils.mjs";

const reachesIntoWorkspaceSource = (specifier, packageScopes) =>
  packageScopes.some(
    (scope) =>
      specifier.startsWith(scope) &&
      (specifier.endsWith("/src") || specifier.includes("/src/")),
  );

export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow package imports that reach into another workspace's src tree.",
      recommended: true,
    },
    messages: {
      noWorkspaceSrcImports:
        "Import '{{importPath}}' reaches into a workspace's src tree. Export a subpath from that package or import its public entrypoint instead.",
    },
  },
  create(context) {
    const { packageScopes } = getExecutorMonorepoSettings(context.settings);

    return createModuleSourceVisitor((sourceNode) => {
      const specifier = readStaticSpecifier(sourceNode);

      if (!specifier || !reachesIntoWorkspaceSource(specifier, packageScopes)) {
        return;
      }

      context.report({
        node: sourceNode,
        messageId: "noWorkspaceSrcImports",
        data: {
          importPath: specifier,
        },
      });
    });
  },
});
