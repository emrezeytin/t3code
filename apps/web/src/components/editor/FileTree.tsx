import type { ProjectEntry } from "@t3tools/contracts";
import { useQuery } from "@tanstack/react-query";
import { ChevronRightIcon, FolderClosedIcon, FolderIcon } from "lucide-react";
import { memo, useCallback, useState } from "react";
import { VscodeEntryIcon } from "~/components/chat/VscodeEntryIcon";
import { useTheme } from "~/hooks/useTheme";
import { projectListDirectoryQueryOptions } from "~/lib/projectReactQuery";
import { cn } from "~/lib/utils";

interface FileTreeProps {
  cwd: string | null;
  selectedPath: string | null;
  onSelectFile: (relativePath: string) => void;
}

interface DirectoryNodeProps {
  entry: ProjectEntry;
  cwd: string | null;
  depth: number;
  selectedPath: string | null;
  onSelectFile: (relativePath: string) => void;
  resolvedTheme: "light" | "dark";
}

const DirectoryNode = memo(function DirectoryNode({
  entry,
  cwd,
  depth,
  selectedPath,
  onSelectFile,
  resolvedTheme,
}: DirectoryNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const childrenQuery = useQuery(
    projectListDirectoryQueryOptions({
      cwd,
      relativePath: entry.path,
      enabled: expanded,
    }),
  );

  const toggle = useCallback(() => setExpanded((v) => !v), []);
  const leftPadding = 8 + depth * 14;

  return (
    <div>
      <button
        type="button"
        className="group flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left hover:bg-accent/50"
        style={{ paddingLeft: `${leftPadding}px` }}
        onClick={toggle}
      >
        <ChevronRightIcon
          aria-hidden="true"
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground/60 transition-transform",
            expanded && "rotate-90",
          )}
        />
        {expanded ? (
          <FolderIcon className="size-3.5 shrink-0 text-muted-foreground/70" />
        ) : (
          <FolderClosedIcon className="size-3.5 shrink-0 text-muted-foreground/70" />
        )}
        <span className="truncate font-mono text-[11px] text-muted-foreground/90">
          {baseName(entry.path)}
        </span>
      </button>

      {expanded && (
        <div>
          {(childrenQuery.isPending || childrenQuery.isPlaceholderData) && (
            <div
              className="py-1 font-mono text-[10px] text-muted-foreground/50"
              style={{ paddingLeft: `${leftPadding + 22}px` }}
            >
              Loading…
            </div>
          )}
          {childrenQuery.isError && (
            <div
              className="py-1 font-mono text-[10px] text-destructive/60"
              style={{ paddingLeft: `${leftPadding + 22}px` }}
            >
              Failed to load
            </div>
          )}
          {childrenQuery.data?.entries.map((child) =>
            child.kind === "directory" ? (
              <DirectoryNode
                key={child.path}
                entry={child}
                cwd={cwd}
                depth={depth + 1}
                selectedPath={selectedPath}
                onSelectFile={onSelectFile}
                resolvedTheme={resolvedTheme}
              />
            ) : (
              <FileNode
                key={child.path}
                entry={child}
                depth={depth + 1}
                selectedPath={selectedPath}
                onSelectFile={onSelectFile}
                resolvedTheme={resolvedTheme}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
});

interface FileNodeProps {
  entry: ProjectEntry;
  depth: number;
  selectedPath: string | null;
  onSelectFile: (relativePath: string) => void;
  resolvedTheme: "light" | "dark";
}

const FileNode = memo(function FileNode({
  entry,
  depth,
  selectedPath,
  onSelectFile,
  resolvedTheme,
}: FileNodeProps) {
  const isSelected = entry.path === selectedPath;
  const leftPadding = 8 + depth * 14 + 18; // extra indent past chevron

  return (
    <button
      type="button"
      className={cn(
        "group flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left",
        isSelected ? "bg-accent text-foreground" : "hover:bg-accent/50",
      )}
      style={{ paddingLeft: `${leftPadding}px` }}
      onClick={() => onSelectFile(entry.path)}
    >
      <VscodeEntryIcon
        pathValue={entry.path}
        kind="file"
        theme={resolvedTheme}
        className="size-3.5 shrink-0 text-muted-foreground/70"
      />
      <span
        className={cn(
          "truncate font-mono text-[11px]",
          isSelected ? "text-foreground" : "text-muted-foreground/80",
        )}
      >
        {baseName(entry.path)}
      </span>
    </button>
  );
});

// ── Root tree (lists the project root) ───────────────────────────────

export const FileTree = memo(function FileTree({ cwd, selectedPath, onSelectFile }: FileTreeProps) {
  const { resolvedTheme } = useTheme();
  const rootQuery = useQuery(
    projectListDirectoryQueryOptions({ cwd, relativePath: ".", enabled: cwd !== null }),
  );

  if (!cwd) {
    return (
      <div className="px-3 py-4 text-center font-mono text-[11px] text-muted-foreground/50">
        No project open
      </div>
    );
  }

  if (rootQuery.isPending || rootQuery.isPlaceholderData) {
    return (
      <div className="flex flex-col gap-1 px-2 py-2">
        {Array.from({ length: 8 }, (_, i) => (
          <div
            key={i}
            className="h-5 animate-pulse rounded bg-muted/30"
            style={{ width: `${55 + ((i * 23) % 40)}%` }}
          />
        ))}
      </div>
    );
  }

  if (rootQuery.isError) {
    return (
      <div className="px-3 py-4 text-center font-mono text-[11px] text-destructive/70">
        Failed to load directory
      </div>
    );
  }

  const entries = rootQuery.data?.entries ?? [];

  if (entries.length === 0) {
    return (
      <div className="px-3 py-4 text-center font-mono text-[11px] text-muted-foreground/50">
        No files found
      </div>
    );
  }

  return (
    <div className="min-h-0 overflow-y-auto py-1">
      {entries.map((entry) =>
        entry.kind === "directory" ? (
          <DirectoryNode
            key={entry.path}
            entry={entry}
            cwd={cwd}
            depth={0}
            selectedPath={selectedPath}
            onSelectFile={onSelectFile}
            resolvedTheme={resolvedTheme}
          />
        ) : (
          <FileNode
            key={entry.path}
            entry={entry}
            depth={0}
            selectedPath={selectedPath}
            onSelectFile={onSelectFile}
            resolvedTheme={resolvedTheme}
          />
        ),
      )}
    </div>
  );
});

function baseName(filePath: string): string {
  const idx = filePath.lastIndexOf("/");
  return idx === -1 ? filePath : filePath.slice(idx + 1);
}
