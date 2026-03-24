import {
  OrchestrationGetFullThreadDiffInput,
  OrchestrationGetTurnDiffInput,
  ThreadId,
} from "@t3tools/contracts";
import { queryOptions } from "@tanstack/react-query";
import { Option, Schema } from "effect";
import { ensureNativeApi } from "../nativeApi";

interface CheckpointDiffQueryInput {
  threadId: ThreadId | null;
  fromTurnCount: number | null;
  toTurnCount: number | null;
  cacheScope?: string | null;
  enabled?: boolean;
}

export const providerQueryKeys = {
  all: ["providers"] as const,
  skills: (threadId: ThreadId | null, hasActiveSession: boolean) =>
    ["providers", "skills", threadId, hasActiveSession] as const,
  checkpointDiff: (input: CheckpointDiffQueryInput) =>
    [
      "providers",
      "checkpointDiff",
      input.threadId,
      input.fromTurnCount,
      input.toTurnCount,
      input.cacheScope ?? null,
    ] as const,
};

function decodeCheckpointDiffRequest(input: CheckpointDiffQueryInput) {
  if (input.fromTurnCount === 0) {
    return Schema.decodeUnknownOption(OrchestrationGetFullThreadDiffInput)({
      threadId: input.threadId,
      toTurnCount: input.toTurnCount,
    }).pipe(Option.map((fields) => ({ kind: "fullThreadDiff" as const, input: fields })));
  }

  return Schema.decodeUnknownOption(OrchestrationGetTurnDiffInput)({
    threadId: input.threadId,
    fromTurnCount: input.fromTurnCount,
    toTurnCount: input.toTurnCount,
  }).pipe(Option.map((fields) => ({ kind: "turnDiff" as const, input: fields })));
}

function asCheckpointErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "";
}

function normalizeCheckpointErrorMessage(error: unknown): string {
  const message = asCheckpointErrorMessage(error).trim();
  if (message.length === 0) {
    return "Failed to load checkpoint diff.";
  }

  const lower = message.toLowerCase();
  if (lower.includes("not a git repository")) {
    return "Turn diffs are unavailable because this project is not a git repository.";
  }

  if (
    lower.includes("checkpoint unavailable for thread") ||
    lower.includes("checkpoint invariant violation")
  ) {
    const separatorIndex = message.indexOf(":");
    if (separatorIndex >= 0) {
      const detail = message.slice(separatorIndex + 1).trim();
      if (detail.length > 0) {
        return detail;
      }
    }
  }

  return message;
}

function isCheckpointTemporarilyUnavailable(error: unknown): boolean {
  const message = asCheckpointErrorMessage(error).toLowerCase();
  return (
    message.includes("exceeds current turn count") ||
    message.includes("checkpoint is unavailable for turn") ||
    message.includes("filesystem checkpoint is unavailable")
  );
}

// ── Provider Skills Cache ────────────────────────────────────────────
// Skills are cached per-project (cwd) in localStorage so they show
// immediately in the slash-command menu even before a session starts.

const SKILLS_CACHE_KEY_PREFIX = "t3:provider-skills:";
const SKILLS_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CachedSkills {
  skills: Array<{ name: string; description: string; argumentHint: string }>;
  cachedAt: number;
}

function readSkillsCache(cwd: string | null): CachedSkills | null {
  if (!cwd) return null;
  try {
    const raw = localStorage.getItem(SKILLS_CACHE_KEY_PREFIX + cwd);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedSkills;
    if (Date.now() - parsed.cachedAt > SKILLS_CACHE_MAX_AGE_MS) {
      localStorage.removeItem(SKILLS_CACHE_KEY_PREFIX + cwd);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeSkillsCache(
  cwd: string | null,
  skills: Array<{ name: string; description: string; argumentHint: string }>,
): void {
  if (!cwd || skills.length === 0) return;
  try {
    localStorage.setItem(
      SKILLS_CACHE_KEY_PREFIX + cwd,
      JSON.stringify({ skills, cachedAt: Date.now() } satisfies CachedSkills),
    );
  } catch {
    // Ignore storage errors
  }
}

export function providerSkillsQueryOptions(input: {
  threadId: ThreadId | null;
  cwd: string | null;
  hasActiveSession: boolean;
  enabled?: boolean;
}) {
  const cached = readSkillsCache(input.cwd);

  type SkillsData = { skills: Array<{ name: string; description: string; argumentHint: string }> };

  return queryOptions({
    queryKey: providerQueryKeys.skills(input.threadId, input.hasActiveSession),
    queryFn: async (): Promise<SkillsData> => {
      const api = ensureNativeApi();
      if (!input.threadId) {
        return { skills: [...(cached?.skills ?? [])] };
      }
      try {
        const result = await api.provider.getSkills({ threadId: input.threadId });
        const skills = [...result.skills];
        if (skills.length > 0) {
          writeSkillsCache(input.cwd, skills);
        }
        return { skills };
      } catch {
        return { skills: [...(cached?.skills ?? [])] };
      }
    },
    // Enable even without a threadId if we have cached data to show
    enabled: (input.enabled ?? true) && (!!input.threadId || cached !== null),
    staleTime: 60_000,
  });
}

export function checkpointDiffQueryOptions(input: CheckpointDiffQueryInput) {
  const decodedRequest = decodeCheckpointDiffRequest(input);

  return queryOptions({
    queryKey: providerQueryKeys.checkpointDiff(input),
    queryFn: async () => {
      const api = ensureNativeApi();
      if (!input.threadId || decodedRequest._tag === "None") {
        throw new Error("Checkpoint diff is unavailable.");
      }
      try {
        if (decodedRequest.value.kind === "fullThreadDiff") {
          return await api.orchestration.getFullThreadDiff(decodedRequest.value.input);
        }
        return await api.orchestration.getTurnDiff(decodedRequest.value.input);
      } catch (error) {
        throw new Error(normalizeCheckpointErrorMessage(error), { cause: error });
      }
    },
    enabled: (input.enabled ?? true) && !!input.threadId && decodedRequest._tag === "Some",
    staleTime: Infinity,
    retry: (failureCount, error) => {
      if (isCheckpointTemporarilyUnavailable(error)) {
        return failureCount < 12;
      }
      return failureCount < 3;
    },
    retryDelay: (attempt, error) =>
      isCheckpointTemporarilyUnavailable(error)
        ? Math.min(5_000, 250 * 2 ** (attempt - 1))
        : Math.min(1_000, 100 * 2 ** (attempt - 1)),
  });
}
