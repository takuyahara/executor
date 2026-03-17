import { defineRule } from "@oxlint/plugins";

const isIdentifierNamed = (node, name) =>
  node?.type === "Identifier" && node.name === name;

const isEffectFailCall = (node) =>
  node?.type === "CallExpression"
  && node.callee?.type === "MemberExpression"
  && node.callee.computed === false
  && isIdentifierNamed(node.callee.object, "Effect")
  && isIdentifierNamed(node.callee.property, "fail");

const isDirectYieldCandidate = (node) => {
  if (!node) {
    return false;
  }

  if (node.type === "CallExpression" || node.type === "NewExpression") {
    return true;
  }

  if (node.type === "ParenthesizedExpression") {
    return isDirectYieldCandidate(node.expression);
  }

  return node.type === "TSAsExpression" || node.type === "TSTypeAssertion";
};

export default defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Disallow `yield* Effect.fail(...)` when the yielded failure value can be yielded directly in Effect.gen.",
      recommended: true,
    },
    messages: {
      noYieldEffectFail:
        "Avoid `yield* Effect.fail(...)` here. In Effect.gen, yield the tagged or yieldable error expression directly instead, for example `yield* new MyTaggedError({ ... })` or `yield* myTaggedError(...)`.",
    },
  },
  create(context) {
    return {
      YieldExpression(node) {
        if (!node.delegate) {
          return;
        }

        if (!isEffectFailCall(node.argument) || node.argument.arguments.length === 0) {
          return;
        }

        if (!isDirectYieldCandidate(node.argument.arguments[0])) {
          return;
        }

        context.report({
          node,
          messageId: "noYieldEffectFail",
        });
      },
    };
  },
});
