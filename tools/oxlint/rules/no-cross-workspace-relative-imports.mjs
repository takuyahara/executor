import { defineRule } from "@oxlint/plugins";

import {
  createModuleSourceVisitor,
  getWorkspaceInfo,
  getWorkspacePackageName,
  isRelativeSpecifier,
  readStaticSpecifier,
  resolveRelativeSpecifier,
} from "../workspace-utils.mjs";

export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow relative imports that cross from one monorepo workspace into another.",
      recommended: true,
    },
    messages: {
      noCrossWorkspaceRelativeImports:
        "Relative import '{{importPath}}' crosses a workspace boundary. Import the target workspace through its package entrypoint instead.{{suggestedPackageHint}}",
    },
  },
  create(context) {
    const currentWorkspace = getWorkspaceInfo(context.cwd, context.filename);

    if (!currentWorkspace) {
      return {};
    }

    return createModuleSourceVisitor((sourceNode) => {
      const specifier = readStaticSpecifier(sourceNode);

      if (!specifier || !isRelativeSpecifier(specifier)) {
        return;
      }

      const resolvedTarget = resolveRelativeSpecifier(context.filename, specifier);
      const targetWorkspace = getWorkspaceInfo(context.cwd, resolvedTarget);

      if (!targetWorkspace || targetWorkspace.root === currentWorkspace.root) {
        return;
      }

      const targetPackageName = getWorkspacePackageName(targetWorkspace.root);

      context.report({
        node: sourceNode,
        messageId: "noCrossWorkspaceRelativeImports",
        data: {
          importPath: specifier,
          suggestedPackageHint: targetPackageName
            ? ` Use ${targetPackageName}.`
            : "",
        },
      });
    });
  },
});
