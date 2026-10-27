import type {
  Candidate,
  Category,
  ConceptNode,
  Exploration,
  Source,
} from "./types.ts";

export const STORAGE_KEY = "concept-atlas:saved:v1";

const MAX_SAVED = 30;
const MAX_STORED_CHARACTERS = 5_000_000;
const MAX_NODES_PER_EXPLORATION = 2_500;
const MAX_DEPTH = 32;

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected an object");
  return value as RecordValue;
}

function text(value: unknown, limit: number, required = false): string {
  if (
    typeof value !== "string" ||
    value.length > limit ||
    (required && !value.trim())
  ) {
    throw new Error("Invalid text");
  }
  return value;
}

function list(value: unknown, limit: number): unknown[] {
  if (!Array.isArray(value) || value.length > limit)
    throw new Error("Invalid list");
  return value;
}

function candidate(value: unknown): Candidate {
  const item = record(value);
  return {
    id: text(item.id, 200, true),
    label: text(item.label, 1_000, true),
    description: text(item.description, 16_000),
  };
}

function source(value: unknown): Source {
  const item = record(value);
  const url = text(item.url, 8_000, true);
  if (/[\u0000-\u0020\u007f]/.test(url)) throw new Error("Invalid source URL");
  const parsed = new URL(url);
  if (
    !["https:", "http:"].includes(parsed.protocol) ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error("Invalid source URL");
  }
  return { label: text(item.label, 1_000, true), url };
}

function exploration(value: unknown): Exploration {
  const item = record(value);
  let nodeCount = 0;
  const nodeIds = new Set<string>();
  const readNode = (value: unknown, depth: number): ConceptNode => {
    if (depth > MAX_DEPTH || ++nodeCount > MAX_NODES_PER_EXPLORATION)
      throw new Error("Tree is too large");
    const node = record(value);
    const id = text(node.id, 200, true);
    if (nodeIds.has(id)) throw new Error("Duplicate node ID");
    nodeIds.add(id);
    if (!["documented", "claim", "inferred"].includes(node.evidence as string))
      throw new Error("Invalid evidence status");
    return {
      id,
      label: text(node.label, 1_000, true),
      description: text(node.description, 16_000),
      evidence: node.evidence as ConceptNode["evidence"],
      explanation: text(node.explanation, 32_000),
      sources: list(node.sources, 100).map(source),
      ...(node.entityId === undefined
        ? {}
        : { entityId: text(node.entityId, 200, true) }),
      ...(node.children === undefined
        ? {}
        : {
            children: list(node.children, 500).map((child) =>
              readNode(child, depth + 1),
            ),
          }),
    };
  };
  const categoryIds = new Set<string>();
  const categories: Category[] = list(item.categories, 100).map((value) => {
    const category = record(value);
    const id = text(category.id, 200, true);
    if (categoryIds.has(id)) throw new Error("Duplicate category ID");
    categoryIds.add(id);
    return {
      id,
      label: text(category.label, 1_000, true),
      description: text(category.description, 16_000),
      nodes: list(category.nodes, 500).map((node) => readNode(node, 0)),
    };
  });
  const createdAt = text(item.createdAt, 100, true);
  if (!Number.isFinite(Date.parse(createdAt)))
    throw new Error("Invalid timestamp");
  if (item.mode !== "wikidata" && item.mode !== "example")
    throw new Error("Invalid exploration mode");
  return {
    id: text(item.id, 200, true),
    root: candidate(item.root),
    categories,
    createdAt,
    warnings: list(item.warnings, 100).map((warning) => text(warning, 16_000)),
    mode: item.mode,
  };
}

function collection(value: unknown): Exploration[] {
  const items = list(value, MAX_SAVED).map(exploration);
  const ids = new Set(items.map((item) => item.id));
  if (ids.size !== items.length) throw new Error("Duplicate exploration ID");
  return items;
}

/** Read only our versioned key. Invalid original data is left intact for recovery. */
export function loadSaved(storage: Pick<Storage, "getItem">): {
  items: Exploration[];
  warning?: string;
} {
  let stored: string | null;
  try {
    stored = storage.getItem(STORAGE_KEY);
  } catch {
    return {
      items: [],
      warning:
        "Saved explorations could not be read. Browser storage may be unavailable; nothing was changed.",
    };
  }
  if (stored === null) return { items: [] };
  try {
    if (stored.length > MAX_STORED_CHARACTERS)
      throw new Error("Stored data is too large");
    return { items: collection(JSON.parse(stored)) };
  } catch {
    return {
      items: [],
      warning:
        "Saved explorations contain invalid or unsupported data and could not be loaded. The original browser data has been preserved. Export any recoverable data before explicitly replacing it with a new save.",
    };
  }
}

/** Pure upsert: replace this ID, retain all other explorations, and put this save first. */
export function saveExploration(
  items: Exploration[],
  value: Exploration,
): Exploration[] {
  const updated = [value, ...items.filter((item) => item.id !== value.id)];
  if (updated.length > MAX_SAVED)
    throw new Error(
      "You can save up to 30 explorations. Export and remove an older exploration before saving a new one.",
    );
  return updated;
}

/** Storage failures propagate so the UI can keep the user's unsaved exploration. */
export function writeSaved(
  storage: Pick<Storage, "setItem">,
  items: Exploration[],
): void {
  collection(items);
  const serialized = JSON.stringify(items);
  if (serialized.length > MAX_STORED_CHARACTERS)
    throw new Error(
      "Saved explorations are too large for browser storage. Export your exploration to keep a copy.",
    );
  storage.setItem(STORAGE_KEY, serialized);
}
