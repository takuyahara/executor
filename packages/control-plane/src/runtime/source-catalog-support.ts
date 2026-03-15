import { sha256Hex } from "@executor/codemode-core";
import type { CatalogSnapshotV1 } from "../ir/model";

export const normalizeSearchText = (
  ...parts: ReadonlyArray<string | null | undefined>
): string =>
  parts
    .flatMap((part) => (part ? [part.trim()] : []))
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

export const contentHash = (value: string): string => sha256Hex(value);

export type SourceCatalogSyncResult = {
  snapshot: CatalogSnapshotV1;
  sourceHash: string | null;
};
