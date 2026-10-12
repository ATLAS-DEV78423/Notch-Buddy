// Agent session steps — one pure module shared by the hook ingestion (island/
// hooks.ts) and the session view (views.ts). Everything here is headless-
// testable: no DOM, no State.

export interface AgentStep {
  /** One-line display label (French, matching the macOS ticker). */
  label: string;
  /** Raw tool name from the hook payload ("" for prompt/notification steps). */
  tool: string;
  /** The tool's arguments, when the hook carried them. */
  input?: Record<string, unknown>;
}

/** Same labels as the macOS app (HookServer.stepLabel). */
const TOOL_LABELS: Record<string, string> = {
  Bash: "Exécute",
  Read: "Lit",
  Write: "Écrit",
  Edit: "Modifie",
  Glob: "Cherche",
  Grep: "Recherche",
  WebSearch: "Recherche web",
  WebFetch: "Récupère",
  TodoWrite: "Tâches",
  Task: "Agent",
  LS: "Liste",
  MultiEdit: "Modifie",
  NotebookEdit: "Notebook",
  PowerShell: "Exécute",
  terminal: "Exécute",
  write_file: "Écrit",
  patch: "Modifie",
};

export function captureStep(tool: string, input: Record<string, unknown> = {}): AgentStep {
  const label = TOOL_LABELS[tool] ?? tool;
  const str = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : null);
  const cmd = str("command");
  if (cmd) return { label: `${label} · ${cmd.slice(0, 40)}`, tool, input };
  const path = str("path");
  if (path) return { label: `${label} · ${baseName(path)}`, tool, input };
  const file = str("file_path");
  if (file) return { label: `${label} · ${baseName(file)}`, tool, input };
  const query = str("query");
  if (query) return { label: `${label} · ${query.slice(0, 40)}`, tool, input };
  return { label, tool, input };
}

export function baseName(p: string): string {
  const cleaned = p.replace(/[\\/]+$/, "");
  const idx = Math.max(cleaned.lastIndexOf("\\"), cleaned.lastIndexOf("/"));
  return idx >= 0 ? cleaned.slice(idx + 1) : cleaned;
}

export type StepKind = "prompt" | "read" | "edit" | "bash" | "other";

const READ_TOOLS = new Set(["Read", "Glob", "Grep", "LS", "WebSearch", "WebFetch"]);
const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit", "patch", "write_file"]);
const BASH_TOOLS = new Set(["Bash", "PowerShell", "terminal"]);

export function stepKind(step: AgentStep): StepKind {
  if (!step.tool) return "prompt";
  if (BASH_TOOLS.has(step.tool)) return "bash";
  if (EDIT_TOOLS.has(step.tool)) return "edit";
  if (READ_TOOLS.has(step.tool)) return "read";
  return "other";
}

export type DiffRowKind = "add" | "del" | "ctx" | "hunk";

export interface DiffRow {
  kind: DiffRowKind;
  text: string;
}

export interface StepDiff {
  path: string;
  rows: DiffRow[];
}

/**
 * The change a step made (or will make), for the session viewer.
 *
 * Three payload shapes exist across the adapters:
 * - OpenCode `session.diff` → `{ file_path, diff }` where diff is a unified patch;
 * - Claude Code Edit/MultiEdit → `{ file_path, old_string, new_string }`;
 * - Claude Code Write → `{ file_path, content }` (everything is new).
 * Anything else (Bash, Read, prompts) has no diff — the viewer shows the
 * command or the label instead.
 */
export function diffForStep(step: AgentStep): StepDiff | null {
  const input = step.input ?? {};
  const str = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : null);
  const path = str("file_path") ?? str("path") ?? "";

  const patch = str("diff");
  if (patch) return { path, rows: parsePatch(patch) };

  const oldStr = str("old_string");
  const newStr = str("new_string");
  if (oldStr !== null || newStr !== null) {
    return { path, rows: diffLines(oldStr ?? "", newStr ?? "") };
  }

  const content = str("content");
  if (content !== null) {
    return { path, rows: content.split("\n").map((text) => ({ kind: "add" as const, text })) };
  }
  return null;
}

/** Unified-patch text → rows (OpenCode's `file.patch`). */
function parsePatch(patch: string): DiffRow[] {
  const rows: DiffRow[] = [];
  for (const line of patch.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("@@")) rows.push({ kind: "hunk", text: line });
    else if (line.startsWith("+")) rows.push({ kind: "add", text: line.slice(1) });
    else if (line.startsWith("-")) rows.push({ kind: "del", text: line.slice(1) });
    else if (line.startsWith(" ")) rows.push({ kind: "ctx", text: line.slice(1) });
    else if (line.length > 0) rows.push({ kind: "ctx", text: line });
  }
  return rows;
}

/**
 * Minimal LCS line diff — old lines out, new lines in, unchanged kept for
 * context. Same shape the macOS DiffEngine produces for an edit.
 */
export function diffLines(oldText: string, newText: string): DiffRow[] {
  const a = oldText.length ? oldText.split("\n") : [];
  const b = newText.length ? newText.split("\n") : [];
  const n = a.length;
  const m = b.length;
  // LCS table (n·m is fine: edits are small and this runs once per step).
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      rows.push({ kind: "ctx", text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ kind: "del", text: a[i] });
      i++;
    } else {
      rows.push({ kind: "add", text: b[j] });
      j++;
    }
  }
  while (i < n) rows.push({ kind: "del", text: a[i++] });
  while (j < m) rows.push({ kind: "add", text: b[j++] });
  return rows;
}

/** "+N −M" counts for a diff, the way the ticker counts a change. */
export function diffStat(rows: DiffRow[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const r of rows) {
    if (r.kind === "add") added++;
    else if (r.kind === "del") removed++;
  }
  return { added, removed };
}

/**
 * Model / thinking level. Nothing invents a value: an agent that doesn't send
 * one (Claude Code's hooks carry no model, for instance) simply has none, and
 * the viewer hides the row rather than guessing. Adapters may send the generic
 * fields or the explicit `coucou_*` ones.
 */
export function modelFromPayload(payload: Record<string, unknown>): string | null {
  for (const key of ["coucou_model", "model", "model_id"]) {
    const v = payload[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

export function thinkingFromPayload(payload: Record<string, unknown>): string | null {
  for (const key of ["coucou_thinking", "thinking", "reasoning_effort", "reasoningEffort", "effort"]) {
    const v = payload[key];
    if (typeof v === "string" && v.trim()) return v.trim().toLowerCase();
  }
  return null;
}
