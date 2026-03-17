import { definePlugin } from "@oxlint/plugins";

import noCrossWorkspaceRelativeImports from "./rules/no-cross-workspace-relative-imports.mjs";
import noWorkspaceSrcImports from "./rules/no-workspace-src-imports.mjs";

export default definePlugin({
  meta: {
    name: "oxlint-plugin-executor-monorepo",
  },
  rules: {
    "no-cross-workspace-relative-imports": noCrossWorkspaceRelativeImports,
    "no-workspace-src-imports": noWorkspaceSrcImports,
  },
});
