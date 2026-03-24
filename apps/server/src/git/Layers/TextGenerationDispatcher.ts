import { Effect, Layer } from "effect";

import { type TextGenerationShape, TextGeneration } from "../Services/TextGeneration.ts";
import { makeCodexTextGeneration } from "./CodexTextGeneration.ts";
import { makeClaudeTextGeneration } from "./ClaudeTextGeneration.ts";

const makeTextGenerationDispatcher = Effect.gen(function* () {
  const codex = yield* makeCodexTextGeneration;
  const claude = yield* makeClaudeTextGeneration;

  const resolve = (provider?: string) =>
    provider === "claudeAgent" ? claude : codex;

  return {
    generateCommitMessage: (input) => resolve(input.provider).generateCommitMessage(input),
    generatePrContent: (input) => resolve(input.provider).generatePrContent(input),
    generateBranchName: (input) => resolve(input.provider).generateBranchName(input),
  } satisfies TextGenerationShape;
});

export const TextGenerationDispatcherLive = Layer.effect(TextGeneration, makeTextGenerationDispatcher);
