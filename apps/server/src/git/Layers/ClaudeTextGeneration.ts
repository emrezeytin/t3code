import { Effect, Option, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { DEFAULT_CLAUDE_TEXT_GENERATION_MODEL } from "@t3tools/contracts";
import { sanitizeBranchFragment, sanitizeFeatureBranchName } from "@t3tools/shared/git";

import { TextGenerationError } from "../Errors.ts";
import {
  type BranchNameGenerationInput,
  type BranchNameGenerationResult,
  type CommitMessageGenerationResult,
  type PrContentGenerationResult,
  type TextGenerationShape,
} from "../Services/TextGeneration.ts";
import { limitSection, sanitizeCommitSubject, sanitizePrTitle } from "./CodexTextGeneration.ts";

const CLAUDE_TIMEOUT_MS = 180_000;

function normalizeClaudeError(
  operation: string,
  error: unknown,
  fallback: string,
): TextGenerationError {
  if (Schema.is(TextGenerationError)(error)) {
    return error;
  }

  if (error instanceof Error) {
    const lower = error.message.toLowerCase();
    if (
      error.message.includes("Command not found: claude") ||
      lower.includes("spawn claude") ||
      lower.includes("enoent")
    ) {
      return new TextGenerationError({
        operation,
        detail: "Claude CLI (`claude`) is required but not available on PATH.",
        cause: error,
      });
    }
    return new TextGenerationError({
      operation,
      detail: `${fallback}: ${error.message}`,
      cause: error,
    });
  }

  return new TextGenerationError({
    operation,
    detail: fallback,
    cause: error,
  });
}

/**
 * Strip markdown code fences from output as a safety measure before JSON parse.
 * Claude sometimes wraps JSON in ```json ... ``` blocks.
 */
function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
  if (fenceMatch) {
    return fenceMatch[1]!.trim();
  }
  return trimmed;
}

export const makeClaudeTextGeneration = Effect.gen(function* () {
  const commandSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const readStreamAsString = <E>(
    operation: string,
    stream: Stream.Stream<Uint8Array, E>,
  ): Effect.Effect<string, TextGenerationError> =>
    Effect.gen(function* () {
      let text = "";
      yield* Stream.runForEach(stream, (chunk) =>
        Effect.sync(() => {
          text += Buffer.from(chunk).toString("utf8");
        }),
      ).pipe(
        Effect.mapError((cause) =>
          normalizeClaudeError(operation, cause, "Failed to collect process output"),
        ),
      );
      return text;
    });

  const runClaudeJson = <S extends Schema.Top>({
    operation,
    cwd,
    prompt,
    outputSchemaJson,
    model,
  }: {
    operation: "generateCommitMessage" | "generatePrContent" | "generateBranchName";
    cwd: string;
    prompt: string;
    outputSchemaJson: S;
    model?: string;
  }): Effect.Effect<S["Type"], TextGenerationError, S["DecodingServices"]> =>
    Effect.gen(function* () {
      const fullPrompt = `${prompt}\n\nRespond with ONLY valid JSON matching this schema, no additional text or markdown:\n${JSON.stringify(Schema.toJsonSchemaDocument(outputSchemaJson).schema)}`;

      const runClaudeCommand = Effect.gen(function* () {
        const command = ChildProcess.make(
          "claude",
          [
            "-p",
            "--model",
            model ?? DEFAULT_CLAUDE_TEXT_GENERATION_MODEL,
            "--output-format",
            "text",
          ],
          {
            cwd,
            shell: process.platform === "win32",
            stdin: {
              stream: Stream.make(new TextEncoder().encode(fullPrompt)),
            },
          },
        );

        const child = yield* commandSpawner
          .spawn(command)
          .pipe(
            Effect.mapError((cause) =>
              normalizeClaudeError(operation, cause, "Failed to spawn Claude CLI process"),
            ),
          );

        const [stdout, stderr, exitCode] = yield* Effect.all(
          [
            readStreamAsString(operation, child.stdout),
            readStreamAsString(operation, child.stderr),
            child.exitCode.pipe(
              Effect.map((value) => Number(value)),
              Effect.mapError((cause) =>
                normalizeClaudeError(operation, cause, "Failed to read Claude CLI exit code"),
              ),
            ),
          ],
          { concurrency: "unbounded" },
        );

        if (exitCode !== 0) {
          const stderrDetail = stderr.trim();
          const stdoutDetail = stdout.trim();
          const detail = stderrDetail.length > 0 ? stderrDetail : stdoutDetail;
          return yield* new TextGenerationError({
            operation,
            detail:
              detail.length > 0
                ? `Claude CLI command failed: ${detail}`
                : `Claude CLI command failed with code ${exitCode}.`,
          });
        }

        return stdout;
      });

      const stdout = yield* runClaudeCommand.pipe(
        Effect.scoped,
        Effect.timeoutOption(CLAUDE_TIMEOUT_MS),
        Effect.flatMap(
          Option.match({
            onNone: () =>
              Effect.fail(
                new TextGenerationError({ operation, detail: "Claude CLI request timed out." }),
              ),
            onSome: (value) => Effect.succeed(value),
          }),
        ),
      );

      const jsonText = stripCodeFences(stdout);

      return yield* Effect.try({
        try: () => JSON.parse(jsonText) as unknown,
        catch: () =>
          new TextGenerationError({
            operation,
            detail: "Claude returned invalid JSON output.",
          }),
      }).pipe(
        Effect.flatMap(Schema.decodeEffect(outputSchemaJson)),
        Effect.catchTag("SchemaError", () =>
          Effect.fail(
            new TextGenerationError({
              operation,
              detail: "Claude returned invalid structured output.",
            }),
          ),
        ),
      );
    });

  const generateCommitMessage: TextGenerationShape["generateCommitMessage"] = (input) => {
    const wantsBranch = input.includeBranch === true;

    const prompt = [
      "You write concise git commit messages.",
      wantsBranch
        ? "Return a JSON object with keys: subject, body, branch."
        : "Return a JSON object with keys: subject, body.",
      "Rules:",
      "- subject must be imperative, <= 72 chars, and no trailing period",
      "- body can be empty string or short bullet points",
      ...(wantsBranch
        ? ["- branch must be a short semantic git branch fragment for this change"]
        : []),
      "- capture the primary user-visible or developer-visible change",
      "",
      `Branch: ${input.branch ?? "(detached)"}`,
      "",
      "Staged files:",
      limitSection(input.stagedSummary, 6_000),
      "",
      "Staged patch:",
      limitSection(input.stagedPatch, 40_000),
    ].join("\n");

    const outputSchemaJson = wantsBranch
      ? Schema.Struct({
          subject: Schema.String,
          body: Schema.String,
          branch: Schema.String,
        })
      : Schema.Struct({
          subject: Schema.String,
          body: Schema.String,
        });

    return runClaudeJson({
      operation: "generateCommitMessage",
      cwd: input.cwd,
      prompt,
      outputSchemaJson,
      ...(input.model ? { model: input.model } : {}),
    }).pipe(
      Effect.map(
        (generated) =>
          ({
            subject: sanitizeCommitSubject(generated.subject),
            body: generated.body.trim(),
            ...("branch" in generated && typeof generated.branch === "string"
              ? { branch: sanitizeFeatureBranchName(generated.branch) }
              : {}),
          }) satisfies CommitMessageGenerationResult,
      ),
    );
  };

  const generatePrContent: TextGenerationShape["generatePrContent"] = (input) => {
    const prompt = [
      "You write GitHub pull request content.",
      "Return a JSON object with keys: title, body.",
      "Rules:",
      "- title should be concise and specific",
      "- body must be markdown and include headings '## Summary' and '## Testing'",
      "- under Summary, provide short bullet points",
      "- under Testing, include bullet points with concrete checks or 'Not run' where appropriate",
      "",
      `Base branch: ${input.baseBranch}`,
      `Head branch: ${input.headBranch}`,
      "",
      "Commits:",
      limitSection(input.commitSummary, 12_000),
      "",
      "Diff stat:",
      limitSection(input.diffSummary, 12_000),
      "",
      "Diff patch:",
      limitSection(input.diffPatch, 40_000),
    ].join("\n");

    return runClaudeJson({
      operation: "generatePrContent",
      cwd: input.cwd,
      prompt,
      outputSchemaJson: Schema.Struct({
        title: Schema.String,
        body: Schema.String,
      }),
      ...(input.model ? { model: input.model } : {}),
    }).pipe(
      Effect.map(
        (generated) =>
          ({
            title: sanitizePrTitle(generated.title),
            body: generated.body.trim(),
          }) satisfies PrContentGenerationResult,
      ),
    );
  };

  const generateBranchName: TextGenerationShape["generateBranchName"] = (input) => {
    return Effect.gen(function* () {
      // Claude `-p` mode doesn't support --image flags, so images are gracefully ignored.
      const attachmentLines = (input.attachments ?? []).map(
        (attachment) =>
          `- ${attachment.name} (${attachment.mimeType}, ${attachment.sizeBytes} bytes)`,
      );

      const promptSections = [
        "You generate concise git branch names.",
        "Return a JSON object with key: branch.",
        "Rules:",
        "- Branch should describe the requested work from the user message.",
        "- Keep it short and specific (2-6 words).",
        "- Use plain words only, no issue prefixes and no punctuation-heavy text.",
        "- If images are attached, use their metadata as context for visual/UI issues.",
        "",
        "User message:",
        limitSection(input.message, 8_000),
      ];
      if (attachmentLines.length > 0) {
        promptSections.push(
          "",
          "Attachment metadata:",
          limitSection(attachmentLines.join("\n"), 4_000),
        );
      }
      const prompt = promptSections.join("\n");

      const generated = yield* runClaudeJson({
        operation: "generateBranchName",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: Schema.Struct({
          branch: Schema.String,
        }),
        ...(input.model ? { model: input.model } : {}),
      });

      return {
        branch: sanitizeBranchFragment(generated.branch),
      } satisfies BranchNameGenerationResult;
    });
  };

  return {
    generateCommitMessage,
    generatePrContent,
    generateBranchName,
  } satisfies TextGenerationShape;
});
