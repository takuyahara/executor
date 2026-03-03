import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import initWasmExtractor, {
  extract_manifest_json_wasm,
} from "./openapi-extractor-wasm/openapi_extractor.js";

let initPromise: Promise<void> | undefined;

const readWasmBytes = async (): Promise<Uint8Array> => {
  const candidates: string[] = [];

  try {
    candidates.push(
      fileURLToPath(new URL("./openapi-extractor-wasm/openapi_extractor_bg.wasm", import.meta.url)),
    );
  } catch {
    // Next.js serverless bundling can provide non-URL import.meta.url values.
  }

  candidates.push(
    join(process.cwd(), "packages/management-api/src/openapi-extractor-wasm/openapi_extractor_bg.wasm"),
    join(
      process.cwd(),
      "node_modules/@executor-v2/management-api/src/openapi-extractor-wasm/openapi_extractor_bg.wasm",
    ),
  );

  const errors: string[] = [];

  for (const candidate of candidates) {
    try {
      return await readFile(candidate);
    } catch (cause) {
      errors.push(`${candidate}: ${String(cause)}`);
    }
  }

  throw new Error(`Unable to load OpenAPI extractor wasm. Tried: ${errors.join(" | ")}`);
};

const ensureWasmReady = (): Promise<void> => {
  if (!initPromise) {
    initPromise = readWasmBytes().then((wasmBytes) =>
      initWasmExtractor({ module_or_path: wasmBytes }).then(() => undefined)
    );
  }

  return initPromise;
};

export const extractOpenApiManifestJsonWithWasm = (
  sourceName: string,
  openApiDocumentText: string,
): Promise<string> =>
  ensureWasmReady().then(() =>
    extract_manifest_json_wasm(sourceName, openApiDocumentText)
  );
