import * as Either from "effect/Either";
import * as ParseResult from "effect/ParseResult";
import * as Schema from "effect/Schema";

const JsonStringMapSchema = Schema.parseJson(
  Schema.Record({
    key: Schema.String,
    value: Schema.String,
  }),
);

const JsonStringArraySchema = Schema.parseJson(
  Schema.Array(Schema.String),
);

const formatJsonFieldError = (
  label: string,
  error: ParseResult.ParseError,
): Error =>
  new Error(
    `${label} is invalid: ${ParseResult.TreeFormatter.formatErrorSync(error)}`,
  );

const decodeJsonField = <A>(input: {
  label: string;
  text: string;
  schema: Schema.Schema<A, string>;
}): A | null => {
  const trimmed = input.text.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const decoded = Schema.decodeUnknownEither(input.schema)(trimmed);
  if (Either.isLeft(decoded)) {
    throw formatJsonFieldError(input.label, decoded.left);
  }

  return decoded.right;
};

export const parseJsonStringMap = (
  label: string,
  text: string,
): Record<string, string> | null => {
  const decoded = decodeJsonField({
    label,
    text,
    schema: JsonStringMapSchema,
  });

  return decoded && Object.keys(decoded).length > 0 ? decoded : null;
};

export const parseJsonStringArray = (
  label: string,
  text: string,
): Array<string> | null => {
  const decoded = decodeJsonField({
    label,
    text,
    schema: JsonStringArraySchema,
  });

  if (!decoded) {
    return null;
  }

  const normalized = decoded
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  return normalized.length > 0 ? normalized : null;
};
