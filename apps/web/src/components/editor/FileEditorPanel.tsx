import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { ThreadId } from "@t3tools/contracts";
import { XIcon, SaveIcon, FolderTreeIcon, PanelRightCloseIcon } from "lucide-react";
import { Suspense, lazy, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useStore } from "~/store";
import { ensureNativeApi } from "~/nativeApi";
import { projectQueryKeys, projectReadFileQueryOptions } from "~/lib/projectReactQuery";
import { FileTree } from "./FileTree";
import { cn } from "~/lib/utils";
import { isElectron } from "~/env";

const CodeEditor = lazy(() =>
  import("./CodeEditor").then((m) => ({ default: m.CodeEditor })),
);

// ── Types ─────────────────────────────────────────────────────────────

interface OpenFile {
  path: string;
  content: string;
  isDirty: boolean;
}

interface FileEditorPanelProps {
  onClose: () => void;
}

// ── Editor tab bar ────────────────────────────────────────────────────

const EditorTabs = memo(function EditorTabs(props: {
  openFiles: OpenFile[];
  activePath: string | null;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
}) {
  const { openFiles, activePath, onSelect, onClose } = props;

  if (openFiles.length === 0) {
    return null;
  }

  return (
    <div className="flex min-h-0 shrink-0 items-end gap-0 overflow-x-auto border-b border-border bg-card/50 pl-1">
      {openFiles.map((file) => {
        const name = file.path.split("/").pop() ?? file.path;
        const isActive = file.path === activePath;
        return (
          <div
            key={file.path}
            className={cn(
              "group flex shrink-0 cursor-pointer items-center gap-1.5 border-r border-border px-3 py-1.5 text-[11px] font-mono transition-colors",
              isActive
                ? "bg-background text-foreground"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
            )}
            onClick={() => onSelect(file.path)}
          >
            <span className="max-w-[120px] truncate">{name}</span>
            {file.isDirty && (
              <span className="size-1.5 shrink-0 rounded-full bg-blue-400" title="Unsaved changes" />
            )}
            <button
              type="button"
              className="ml-0.5 rounded p-0.5 opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                onClose(file.path);
              }}
              title="Close tab"
            >
              <XIcon className="size-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
});

// ── Active file loader ────────────────────────────────────────────────

function ActiveFileEditor(props: {
  cwd: string;
  file: OpenFile;
  onChange: (path: string, content: string) => void;
}) {
  const { cwd, file, onChange } = props;

  // We loaded the initial content when opening — here we just render the editor
  return (
    <div className="min-h-0 flex-1 overflow-hidden">
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center font-mono text-[11px] text-muted-foreground/50">
            Loading editor…
          </div>
        }
      >
        <CodeEditor
          value={file.content}
          onChange={(value) => onChange(file.path, value)}
          filename={file.path}
          className="h-full"
        />
      </Suspense>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────

export const FileEditorPanel = memo(function FileEditorPanel({
  onClose,
}: FileEditorPanelProps) {
  const routeThreadId = useParams({
    strict: false,
    select: (params) => (params.threadId ? ThreadId.makeUnsafe(params.threadId) : null),
  });
  const activeThread = useStore((store) =>
    routeThreadId ? store.threads.find((thread) => thread.id === routeThreadId) : undefined,
  );
  const activeProject = useStore((store) =>
    activeThread?.projectId
      ? store.projects.find((project) => project.id === activeThread.projectId)
      : undefined,
  );
  const cwd: string | null = activeThread?.worktreePath ?? activeProject?.cwd ?? null;

  // ── Open files state ──────────────────────────────────────────────
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [treeVisible, setTreeVisible] = useState(true);
  const queryClient = useQueryClient();

  const activeFile = openFiles.find((f) => f.path === activePath) ?? null;

  // Clear open tabs when the project root changes (switching projects)
  useEffect(() => {
    setOpenFiles([]);
    setActivePath(null);
  }, [cwd]);

  // ── Open file from tree click ─────────────────────────────────────
  const handleSelectFile = useCallback(
    async (relativePath: string) => {
      // If already open, just activate
      const existing = openFiles.find((f) => f.path === relativePath);
      if (existing) {
        setActivePath(relativePath);
        return;
      }

      if (!cwd) return;

      // Fetch file content
      try {
        const result = await queryClient.fetchQuery(
          projectReadFileQueryOptions({ cwd, relativePath }),
        );
        setOpenFiles((prev) => [
          ...prev,
          { path: relativePath, content: result.contents, isDirty: false },
        ]);
        setActivePath(relativePath);
      } catch {
        // File may be binary or unreadable — show placeholder
        setOpenFiles((prev) => [
          ...prev,
          { path: relativePath, content: "// Cannot read file", isDirty: false },
        ]);
        setActivePath(relativePath);
      }
    },
    [cwd, openFiles, queryClient],
  );

  // ── Content change ────────────────────────────────────────────────
  const handleChange = useCallback((path: string, content: string) => {
    setOpenFiles((prev) =>
      prev.map((f) => (f.path === path ? { ...f, content, isDirty: true } : f)),
    );
  }, []);

  // ── Close tab ─────────────────────────────────────────────────────
  const handleCloseTab = useCallback(
    (path: string) => {
      setOpenFiles((prev) => {
        const next = prev.filter((f) => f.path !== path);
        if (activePath === path) {
          setActivePath(next[next.length - 1]?.path ?? null);
        }
        return next;
      });
    },
    [activePath],
  );

  // ── Save ──────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);

  const handleSave = useCallback(async () => {
    if (!activeFile || !cwd || !activeFile.isDirty) return;
    setSaving(true);
    try {
      const api = ensureNativeApi();
      await api.projects.writeFile({
        cwd,
        relativePath: activeFile.path,
        contents: activeFile.content,
      });
      setOpenFiles((prev) =>
        prev.map((f) => (f.path === activeFile.path ? { ...f, isDirty: false } : f)),
      );
      // Invalidate file read cache
      void queryClient.invalidateQueries({
        queryKey: projectQueryKeys.readFile(cwd, activeFile.path),
      });
    } finally {
      setSaving(false);
    }
  }, [activeFile, cwd, queryClient]);

  // ── Keyboard shortcut (Cmd/Ctrl+S) ───────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s" && activeFile?.isDirty) {
        e.preventDefault();
        void handleSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleSave, activeFile]);

  const headerDragRegion = isElectron;

  return (
    <div className="flex h-full min-w-0 flex-col bg-background">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div
        className={cn(
          "flex shrink-0 items-center gap-2 border-b border-border px-3",
          headerDragRegion ? "drag-region h-[52px]" : "h-11",
        )}
      >
        <button
          type="button"
          onClick={() => setTreeVisible((v) => !v)}
          title="Toggle file tree"
          className="rounded p-1 text-muted-foreground/70 hover:bg-accent/60 hover:text-foreground"
        >
          <FolderTreeIcon className="size-4" />
        </button>

        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground/70">
          {activeFile ? activeFile.path : cwd ? "Files" : "No project"}
        </span>

        {activeFile?.isDirty && (
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium text-blue-400 hover:bg-accent/60 disabled:opacity-50"
            title="Save file (⌘S)"
          >
            <SaveIcon className="size-3" />
            {saving ? "Saving…" : "Save"}
          </button>
        )}

        <button
          type="button"
          onClick={onClose}
          title="Close file editor"
          className="rounded p-1 text-muted-foreground/60 hover:bg-accent/60 hover:text-foreground"
        >
          <PanelRightCloseIcon className="size-4" />
        </button>
      </div>

      {/* ── Body ────────────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* File tree */}
        {treeVisible && (
          <div className="flex w-52 shrink-0 flex-col overflow-hidden border-r border-border bg-card/30">
            <FileTree
              cwd={cwd}
              selectedPath={activePath}
              onSelectFile={handleSelectFile}
            />
          </div>
        )}

        {/* Editor area */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <EditorTabs
            openFiles={openFiles}
            activePath={activePath}
            onSelect={setActivePath}
            onClose={handleCloseTab}
          />

          {activeFile ? (
            <ActiveFileEditor
              cwd={cwd ?? ""}
              file={activeFile}
              onChange={handleChange}
            />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
              <FolderTreeIcon className="size-8 text-muted-foreground/20" />
              <p className="font-mono text-[11px] text-muted-foreground/40">
                Click a file to open it
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
