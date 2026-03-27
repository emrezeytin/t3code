import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
  HighlightStyle,
  type LanguageDescription,
  type LanguageSupport,
  defaultHighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { search, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { tags } from "@lezer/highlight";
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

import { useTheme } from "~/hooks/useTheme";

// ── Light theme ────────────────────────────────────────────────────────

const lightHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: "#0000ff" },
  { tag: tags.controlKeyword, color: "#af00db" },
  { tag: tags.definitionKeyword, color: "#0000ff" },
  { tag: tags.moduleKeyword, color: "#0000ff" },
  { tag: tags.string, color: "#a31515" },
  { tag: tags.special(tags.string), color: "#a31515" },
  { tag: tags.regexp, color: "#811f3f" },
  { tag: tags.comment, color: "#008000", fontStyle: "italic" },
  { tag: tags.number, color: "#098658" },
  { tag: tags.bool, color: "#0000ff" },
  { tag: tags.null, color: "#0000ff" },
  { tag: tags.className, color: "#267f99" },
  { tag: tags.typeName, color: "#267f99" },
  { tag: tags.typeOperator, color: "#267f99" },
  { tag: tags.propertyName, color: "#001080" },
  { tag: tags.function(tags.variableName), color: "#795e26" },
  { tag: tags.function(tags.propertyName), color: "#795e26" },
  { tag: tags.definition(tags.variableName), color: "#001080" },
  { tag: tags.attributeName, color: "#e50000" },
  { tag: tags.attributeValue, color: "#0000ff" },
  { tag: tags.tagName, color: "#800000" },
  { tag: tags.angleBracket, color: "#800000" },
  { tag: tags.operator, color: "#000000" },
  { tag: tags.punctuation, color: "#383838" },
]);

const lightBaseTheme = EditorView.theme(
  {
    "&": { backgroundColor: "var(--background)", color: "var(--foreground)" },
    ".cm-content": { caretColor: "var(--foreground)" },
    "&.cm-focused .cm-cursor": { borderLeftColor: "var(--foreground)" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
      backgroundColor: "color-mix(in srgb, var(--primary) 20%, transparent)",
    },
    ".cm-searchMatch": {
      backgroundColor: "color-mix(in srgb, #ff0 40%, transparent)",
      outline: "1px solid #ff060",
    },
    ".cm-searchMatch.cm-searchMatch-selected": {
      backgroundColor: "color-mix(in srgb, #ff6a00 30%, transparent)",
    },
    ".cm-activeLine": {
      backgroundColor: "color-mix(in srgb, var(--accent) 60%, transparent)",
    },
    ".cm-selectionMatch": {
      backgroundColor: "color-mix(in srgb, var(--accent) 80%, transparent)",
    },
    ".cm-gutters": {
      backgroundColor: "var(--card)",
      color: "var(--muted-foreground)",
      borderRight: "1px solid var(--border)",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "color-mix(in srgb, var(--accent) 60%, transparent)",
    },
    ".cm-tooltip": {
      border: "1px solid var(--border)",
      backgroundColor: "var(--popover)",
      color: "var(--popover-foreground)",
    },
  },
  { dark: false },
);

// ── Theme selection ────────────────────────────────────────────────────

function getThemeExtension(isDark: boolean): Extension {
  return isDark ? oneDark : [lightBaseTheme, syntaxHighlighting(lightHighlightStyle)];
}

// ── Base extensions (layout/behavior only — no color theme) ───────────

const BASE_EXTENSIONS: Extension[] = [
  lineNumbers(),
  highlightSpecialChars(),
  history(),
  drawSelection(),
  dropCursor(),
  indentOnInput(),
  syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
  rectangularSelection(),
  keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
  search({ top: false }),
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
  wordWrap?: boolean;
  className?: string;
}

export function CodeEditor({
  value,
  onChange,
  filename,
  readOnly = false,
  wordWrap = true,
  className,
}: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Stable compartment instances for hot-swapping extensions
  const themeCompartment = useRef(new Compartment()).current;
  const wrapCompartment = useRef(new Compartment()).current;

  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  // Use refs so the async init closure always reads the latest values
  const isDarkRef = useRef(isDark);
  isDarkRef.current = isDark;
  const wordWrapRef = useRef(wordWrap);
  wordWrapRef.current = wordWrap;

  // Create/destroy the editor when filename or readOnly changes
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
        themeCompartment.of(getThemeExtension(isDarkRef.current)),
        wrapCompartment.of(wordWrapRef.current ? EditorView.lineWrapping : []),
        updateListener,
        EditorState.readOnly.of(readOnly),
      ];

      if (languageSupport) extensions.push(languageSupport);

      const state = EditorState.create({ doc: value, extensions });
      const view = new EditorView({ state, parent: containerRef.current! });
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

  // Hot-swap the theme when the app's resolved theme changes
  useEffect(() => {
    const view = editorViewRef.current;
    if (!view) return;
    view.dispatch({
      effects: themeCompartment.reconfigure(getThemeExtension(isDark)),
    });
  }, [isDark, themeCompartment]);

  // Hot-swap line wrapping when wordWrap prop changes
  useEffect(() => {
    const view = editorViewRef.current;
    if (!view) return;
    view.dispatch({
      effects: wrapCompartment.reconfigure(wordWrap ? EditorView.lineWrapping : []),
    });
  }, [wordWrap, wrapCompartment]);

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
