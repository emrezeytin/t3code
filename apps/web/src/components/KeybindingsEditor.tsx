import type { KeybindingCommand, ResolvedKeybindingsConfig } from "@t3tools/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { PencilIcon } from "lucide-react";
import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import { formatShortcutLabel } from "~/keybindings";
import { keybindingFromEvent, serializeWhenAst } from "~/lib/keybindingCapture";
import { serverQueryKeys } from "~/lib/serverReactQuery";
import { ensureNativeApi } from "~/nativeApi";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

const COMMAND_LABELS: Record<string, string> = {
  "terminal.toggle": "Toggle Terminal",
  "terminal.split": "Split Terminal",
  "terminal.new": "New Terminal",
  "terminal.close": "Close Terminal",
  "diff.toggle": "Toggle Diff",
  "chat.new": "New Chat",
  "chat.newLocal": "New Local Chat",
  "editor.openFavorite": "Open Favorite Editor",
};

interface KeybindingsEditorProps {
  keybindings: ResolvedKeybindingsConfig;
  keybindingsConfigPath: string | null;
  onOpenFile: () => void;
  isOpeningFile: boolean;
  openFileError: string | null;
}

export default function KeybindingsEditor({
  keybindings,
  keybindingsConfigPath,
  onOpenFile,
  isOpeningFile,
  openFileError,
}: KeybindingsEditorProps) {
  const queryClient = useQueryClient();
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [capturedKey, setCapturedKey] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const staticBindings = keybindings
    .map((binding, index) => ({ binding, index }))
    .filter(({ binding }) => !binding.command.startsWith("script."));

  useEffect(() => {
    if (editingIndex !== null && inputRef.current) {
      inputRef.current.focus();
    }
  }, [editingIndex]);

  const startEditing = useCallback((index: number) => {
    setEditingIndex(index);
    setCapturedKey("");
    setError(null);
  }, []);

  const cancelEditing = useCallback(() => {
    setEditingIndex(null);
    setCapturedKey("");
    setError(null);
  }, []);

  const saveKeybinding = useCallback(
    async (command: KeybindingCommand, key: string, when?: string) => {
      setSaving(true);
      setError(null);
      try {
        const api = ensureNativeApi();
        const rule: { key: string; command: KeybindingCommand; when?: string } = { key, command };
        if (when) {
          rule.when = when;
        }
        await api.server.upsertKeybinding(rule);
        await queryClient.invalidateQueries({ queryKey: serverQueryKeys.all });
        setEditingIndex(null);
        setCapturedKey("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save keybinding.");
      } finally {
        setSaving(false);
      }
    },
    [queryClient],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>, bindingIndex: number) => {
      if (event.key === "Tab") return;
      event.preventDefault();
      event.stopPropagation();

      if (event.key === "Escape") {
        cancelEditing();
        return;
      }

      const next = keybindingFromEvent(event);
      if (!next) return;

      setCapturedKey(next);

      const entry = staticBindings.find(({ index }) => index === bindingIndex);
      if (!entry) return;

      const when = entry.binding.whenAst ? serializeWhenAst(entry.binding.whenAst) : undefined;

      void saveKeybinding(entry.binding.command, next, when);
    },
    [cancelEditing, saveKeybinding, staticBindings],
  );

  return (
    <div className="mt-3 space-y-3">
      <div className="divide-y divide-border rounded-lg border">
        {staticBindings.map(({ binding, index }) => {
          const label = COMMAND_LABELS[binding.command] ?? binding.command;
          const isEditing = editingIndex === index;
          const shortcutLabel = formatShortcutLabel(binding.shortcut);

          let whenLabel: string | null = null;
          if (binding.whenAst) {
            whenLabel = serializeWhenAst(binding.whenAst);
          }

          return (
            <div key={index} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <span className="text-sm font-medium text-foreground">{label}</span>
                {whenLabel ? (
                  <span className="ml-2 inline-block rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {whenLabel}
                  </span>
                ) : null}
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                {isEditing ? (
                  <Input
                    ref={inputRef}
                    className="h-7 w-36 text-center text-xs"
                    placeholder="Press shortcut..."
                    value={capturedKey || ""}
                    readOnly
                    onKeyDown={(event) => handleKeyDown(event, index)}
                    onBlur={cancelEditing}
                    disabled={saving}
                  />
                ) : (
                  <>
                    <kbd className="inline-flex h-7 min-w-14 items-center justify-center rounded border bg-muted px-2 text-xs font-medium text-muted-foreground">
                      {shortcutLabel}
                    </kbd>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      className="size-6 text-muted-foreground hover:text-foreground"
                      aria-label={`Edit shortcut for ${label}`}
                      onClick={() => startEditing(index)}
                    >
                      <PencilIcon className="size-3" />
                    </Button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      <div className="space-y-1.5">
        <span className="block break-all font-mono text-[11px] text-muted-foreground">
          {keybindingsConfigPath ?? "Resolving keybindings path..."}
        </span>
        {openFileError ? (
          <span className="block text-[11px] text-destructive">{openFileError}</span>
        ) : (
          <span className="block text-[11px] text-muted-foreground">
            Open in your preferred editor for advanced configuration.
          </span>
        )}
        <Button
          size="xs"
          variant="outline"
          disabled={!keybindingsConfigPath || isOpeningFile}
          onClick={onOpenFile}
        >
          {isOpeningFile ? "Opening..." : "Open file"}
        </Button>
      </div>
    </div>
  );
}
