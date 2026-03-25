import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
  type LanguageDescription,
  type LanguageSupport,
  StreamLanguage,
  indentOnInput,
  syntaxHighlighting,
  defaultHighlightStyle,
} from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { search, searchKeymap } from "@codemirror/search";
import { EditorState, type Extension } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view";
import { useEffect, useRef } from "react";

// ── Base extensions (always active) ──────────────────────────────────

const BASE_EXTENSIONS: Extension[] = [
  lineNumbers(),
  highlightSpecialChars(),
  history(),
  drawSelection(),
  dropCursor(),
  indentOnInput(),
  syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
  rectangularSelection(),
  EditorView.lineWrapping,
  keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
  search({ top: false }),
  oneDark,
  EditorView.theme({
    "&": { height: "100%", fontSize: "13px" },
    ".cm-scroller": { fontFamily: "var(--font-mono, 'Fira Mono', monospace)", overflow: "auto" },
    ".cm-content": { padding: "8px 0" },
  }),
];

// ── Language detection ────────────────────────────────────────────────

async function detectLanguage(filename: string): Promise<LanguageSupport | null> {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const basename = filename.split("/").pop() ?? filename;

  // Special cases not covered by extension alone
  const specialNames: Record<string, string> = {
    Makefile: "cmake",
    Dockerfile: "dockerfile",
    ".env": "properties",
    ".gitignore": "properties",
  };

  const specialLang = specialNames[basename];
  if (specialLang) {
    const found = languages.find((l) => l.name.toLowerCase() === specialLang);
    if (found) return found.load();
  }

  const found = languages.find((lang: LanguageDescription) => {
    const extensions = lang.extensions ?? [];
    return extensions.includes(ext) || extensions.includes(`.${ext}`);
  });

  if (!found) return null;
  return found.load();
}

// ── Component ─────────────────────────────────────────────────────────

export interface CodeEditorProps {
  value: string;
  onChange?: (value: string) => void;
  filename?: string;
  readOnly?: boolean;
  className?: string;
}

export function CodeEditor({
  value,
  onChange,
  filename,
  readOnly = false,
  className,
}: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Detect language and create/destroy the editor when filename changes
  useEffect(() => {
    if (!containerRef.current) return;

    let cancelled = false;

    const init = async () => {
      const languageSupport = filename ? await detectLanguage(filename) : null;
      if (cancelled) return;

      const updateListener = EditorView.updateListener.of((update) => {
        if (update.docChanged && !readOnly) {
          onChangeRef.current?.(update.state.doc.toString());
        }
      });

      const extensions: Extension[] = [
        ...BASE_EXTENSIONS,
        updateListener,
        EditorState.readOnly.of(readOnly),
      ];

      if (languageSupport) {
        extensions.push(languageSupport);
      }

      const state = EditorState.create({
        doc: value,
        extensions,
      });

      const view = new EditorView({
        state,
        parent: containerRef.current!,
      });

      editorViewRef.current = view;
    };

    void init();

    return () => {
      cancelled = true;
      editorViewRef.current?.destroy();
      editorViewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filename, readOnly]);

  // Update content when value prop changes externally (e.g. after save refresh)
  useEffect(() => {
    const view = editorViewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
    }
  }, [value]);

  return (
    <div ref={containerRef} className={className} style={{ height: "100%", overflow: "hidden" }} />
  );
}
