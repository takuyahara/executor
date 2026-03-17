import { defineRule } from "@oxlint/plugins";

const BUILTIN_ERROR_NAMES = new Set([
  "AggregateError",
  "Error",
  "EvalError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "TypeError",
  "URIError",
]);

const isIdentifierNamed = (node, name) =>
  node?.type === "Identifier" && node.name === name;

const isEffectFailCall = (node) =>
  node?.type === "CallExpression"
  && node.callee?.type === "MemberExpression"
  && node.callee.computed === false
  && isIdentifierNamed(node.callee.object, "Effect")
  && isIdentifierNamed(node.callee.property, "fail");

const readBuiltinErrorName = (node) => {
  if (
    node?.type === "NewExpression"
    && node.callee?.type === "Identifier"
    && BUILTIN_ERROR_NAMES.has(node.callee.name)
  ) {
    return node.callee.name;
  }

  if (
    node?.type === "CallExpression"
    && node.callee?.type === "Identifier"
    && BUILTIN_ERROR_NAMES.has(node.callee.name)
  ) {
    return node.callee.name;
  }

  return null;
};

const readBuiltinFailedErrorName = (node) => {
  if (!isEffectFailCall(node) || node.arguments.length === 0) {
    return null;
  }

  return readBuiltinErrorName(node.arguments[0]);
};

export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow failing Effects with builtin Error constructors instead of tagged Effect errors.",
      recommended: true,
    },
    messages: {
      noRawEffectFailErrors:
        "Do not pass builtin {{errorName}} to Effect.fail. Use a Data.TaggedError or Schema.TaggedError instead. If no suitable tagged error exists, define one near this module with structured fields and fail with that tagged error rather than interpolating context into a message string.",
      noRawYieldedEffectFailErrors:
        "Do not `yield* Effect.fail` with builtin {{errorName}}. In Effect.gen, prefer yielding the tagged error directly, for example `yield* new MyTaggedError({ ... })`. If no suitable Data.TaggedError or Schema.TaggedError exists, define one near this module with structured fields instead of interpolating context into a message string.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const errorName = readBuiltinFailedErrorName(node);

        if (!errorName) {
          return;
        }

        if (
          node.parent?.type === "YieldExpression"
          && node.parent.argument === node
        ) {
          return;
        }

        context.report({
          node: node.arguments[0],
          messageId: "noRawEffectFailErrors",
          data: {
            errorName,
          },
        });
      },
      YieldExpression(node) {
        const failedCall = node.argument;
        const errorName = readBuiltinFailedErrorName(failedCall);

        if (!errorName) {
          return;
        }

        context.report({
          node: failedCall.arguments[0],
          messageId: "noRawYieldedEffectFailErrors",
          data: {
            errorName,
          },
        });
      },
    };
  },
});
