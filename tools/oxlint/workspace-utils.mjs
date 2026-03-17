import { readFileSync } from "node:fs";
import path from "node:path";

const packageNameCache = new Map();

const DEFAULT_PACKAGE_SCOPES = ["@executor/"];

export const getExecutorMonorepoSettings = (settings) => {
  const packageScopes = Array.isArray(settings?.executorMonorepo?.packageScopes)
    ? settings.executorMonorepo.packageScopes.filter(
        (scope) => typeof scope === "string" && scope.length > 0,
      )
    : DEFAULT_PACKAGE_SCOPES;

  return {
    packageScopes: packageScopes.length > 0 ? packageScopes : DEFAULT_PACKAGE_SCOPES,
  };
};

export const getWorkspaceInfo = (cwd, filePath) => {
  const relativePath = path.relative(cwd, filePath);

  if (
    relativePath.length === 0 ||
    relativePath.startsWith(`..${path.sep}`) ||
    relativePath === ".." ||
    path.isAbsolute(relativePath)
  ) {
    return null;
  }

  const segments = relativePath.split(path.sep).filter(Boolean);

  if (segments[0] === "apps" && segments.length >= 2) {
    return {
      kind: "app",
      root: path.join(cwd, "apps", segments[1]),
    };
  }

  if (segments[0] === "packages" && segments.length >= 3) {
    return {
      kind: "package",
      root: path.join(cwd, "packages", segments[1], segments[2]),
    };
  }

  return null;
};

export const getWorkspacePackageName = (workspaceRoot) => {
  if (packageNameCache.has(workspaceRoot)) {
    return packageNameCache.get(workspaceRoot);
  }

  let packageName = null;

  try {
    const packageJson = JSON.parse(
      readFileSync(path.join(workspaceRoot, "package.json"), "utf8"),
    );

    if (typeof packageJson.name === "string" && packageJson.name.length > 0) {
      packageName = packageJson.name;
    }
  } catch {
    packageName = null;
  }

  packageNameCache.set(workspaceRoot, packageName);
  return packageName;
};

export const isRelativeSpecifier = (specifier) =>
  specifier.startsWith("./") || specifier.startsWith("../");

export const resolveRelativeSpecifier = (filename, specifier) =>
  path.resolve(path.dirname(filename), specifier);

export const readStaticSpecifier = (node) => {
  if (!node) {
    return null;
  }

  if (node.type === "Literal" && typeof node.value === "string") {
    return node.value;
  }

  if (node.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis[0]?.value?.cooked ?? null;
  }

  return null;
};

export const createModuleSourceVisitor = (visitSource) => ({
  ImportDeclaration(node) {
    visitSource(node.source);
  },
  ExportAllDeclaration(node) {
    if (node.source) {
      visitSource(node.source);
    }
  },
  ExportNamedDeclaration(node) {
    if (node.source) {
      visitSource(node.source);
    }
  },
  ImportExpression(node) {
    visitSource(node.source);
  },
  CallExpression(node) {
    if (
      node.callee.type === "Identifier" &&
      node.callee.name === "require" &&
      node.arguments.length > 0
    ) {
      visitSource(node.arguments[0]);
    }
  },
});
