import type { KeyboardEvent } from "react";
import type { KeybindingWhenNode } from "@t3tools/contracts";
import { isMacPlatform } from "./utils";

export function normalizeShortcutKeyToken(key: string): string | null {
  const normalized = key.toLowerCase();
  if (
    normalized === "meta" ||
    normalized === "control" ||
    normalized === "ctrl" ||
    normalized === "shift" ||
    normalized === "alt" ||
    normalized === "option"
  ) {
    return null;
  }
  if (normalized === " ") return "space";
  if (normalized === "escape") return "esc";
  if (normalized === "arrowup") return "arrowup";
  if (normalized === "arrowdown") return "arrowdown";
  if (normalized === "arrowleft") return "arrowleft";
  if (normalized === "arrowright") return "arrowright";
  if (normalized.length === 1) return normalized;
  if (normalized.startsWith("f") && normalized.length <= 3) return normalized;
  if (normalized === "enter" || normalized === "tab" || normalized === "backspace") {
    return normalized;
  }
  if (normalized === "delete" || normalized === "home" || normalized === "end") {
    return normalized;
  }
  if (normalized === "pageup" || normalized === "pagedown") return normalized;
  return null;
}

export function keybindingFromEvent(event: KeyboardEvent<HTMLInputElement>): string | null {
  const keyToken = normalizeShortcutKeyToken(event.key);
  if (!keyToken) return null;

  const parts: string[] = [];
  if (isMacPlatform(navigator.platform)) {
    if (event.metaKey) parts.push("mod");
    if (event.ctrlKey) parts.push("ctrl");
  } else {
    if (event.ctrlKey) parts.push("mod");
    if (event.metaKey) parts.push("meta");
  }
  if (event.altKey) parts.push("alt");
  if (event.shiftKey) parts.push("shift");
  if (parts.length === 0) {
    return null;
  }
  parts.push(keyToken);
  return parts.join("+");
}

export function serializeWhenAst(node: KeybindingWhenNode): string {
  switch (node.type) {
    case "identifier":
      return node.name;
    case "not":
      if (node.node.type === "identifier") {
        return `!${node.node.name}`;
      }
      return `!(${serializeWhenAst(node.node)})`;
    case "and": {
      const left =
        node.left.type === "or" ? `(${serializeWhenAst(node.left)})` : serializeWhenAst(node.left);
      const right =
        node.right.type === "or"
          ? `(${serializeWhenAst(node.right)})`
          : serializeWhenAst(node.right);
      return `${left} && ${right}`;
    }
    case "or": {
      const left = serializeWhenAst(node.left);
      const right = serializeWhenAst(node.right);
      return `${left} || ${right}`;
    }
  }
}
