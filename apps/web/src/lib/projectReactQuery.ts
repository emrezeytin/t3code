import type { ProjectListDirectoryResult, ProjectSearchEntriesResult } from "@t3tools/contracts";
import { queryOptions } from "@tanstack/react-query";
import { ensureNativeApi } from "~/nativeApi";

export const projectQueryKeys = {
  all: ["projects"] as const,
  searchEntries: (cwd: string | null, query: string, limit: number) =>
    ["projects", "search-entries", cwd, query, limit] as const,
  readFile: (cwd: string | null, relativePath: string) =>
    ["projects", "read-file", cwd, relativePath] as const,
  listDirectory: (cwd: string | null, relativePath: string) =>
    ["projects", "list-directory", cwd, relativePath] as const,
};

const DEFAULT_SEARCH_ENTRIES_LIMIT = 80;
const DEFAULT_SEARCH_ENTRIES_STALE_TIME = 15_000;
const EMPTY_SEARCH_ENTRIES_RESULT: ProjectSearchEntriesResult = {
  entries: [],
  truncated: false,
};

export function projectSearchEntriesQueryOptions(input: {
  cwd: string | null;
  query: string;
  enabled?: boolean;
  limit?: number;
  staleTime?: number;
}) {
  const limit = input.limit ?? DEFAULT_SEARCH_ENTRIES_LIMIT;
  return queryOptions({
    queryKey: projectQueryKeys.searchEntries(input.cwd, input.query, limit),
    queryFn: async () => {
      const api = ensureNativeApi();
      if (!input.cwd) {
        throw new Error("Workspace entry search is unavailable.");
      }
      return api.projects.searchEntries({
        cwd: input.cwd,
        query: input.query,
        limit,
      });
    },
    enabled: (input.enabled ?? true) && input.cwd !== null && input.query.length > 0,
    staleTime: input.staleTime ?? DEFAULT_SEARCH_ENTRIES_STALE_TIME,
    placeholderData: (previous) => previous ?? EMPTY_SEARCH_ENTRIES_RESULT,
  });
}

const FILE_READ_STALE_TIME = 30_000;

export function projectReadFileQueryOptions(input: {
  cwd: string | null;
  relativePath: string;
  enabled?: boolean;
}) {
  return queryOptions({
    queryKey: projectQueryKeys.readFile(input.cwd, input.relativePath),
    queryFn: async () => {
      const api = ensureNativeApi();
      if (!input.cwd) throw new Error("File read is unavailable.");
      return api.projects.readFile({ cwd: input.cwd, relativePath: input.relativePath });
    },
    enabled: (input.enabled ?? true) && input.cwd !== null && input.relativePath.length > 0,
    staleTime: FILE_READ_STALE_TIME,
  });
}

const DIRECTORY_LIST_STALE_TIME = 10_000;
const EMPTY_DIRECTORY_RESULT: ProjectListDirectoryResult = { entries: [], truncated: false };

export function projectListDirectoryQueryOptions(input: {
  cwd: string | null;
  relativePath: string;
  enabled?: boolean;
}) {
  return queryOptions({
    queryKey: projectQueryKeys.listDirectory(input.cwd, input.relativePath),
    queryFn: async () => {
      const api = ensureNativeApi();
      if (!input.cwd) throw new Error("Directory listing is unavailable.");
      return api.projects.listDirectory({ cwd: input.cwd, relativePath: input.relativePath });
    },
    enabled: (input.enabled ?? true) && input.cwd !== null,
    staleTime: DIRECTORY_LIST_STALE_TIME,
    placeholderData: (previous) => previous ?? EMPTY_DIRECTORY_RESULT,
  });
}
