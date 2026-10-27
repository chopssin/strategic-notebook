import assert from "node:assert/strict";
import test from "node:test";
import { exportJSON, exportMarkdown } from "../src/atlas/export.ts";
import {
  loadSaved,
  saveExploration,
  STORAGE_KEY,
  writeSaved,
} from "../src/atlas/storage.ts";
import type { Exploration } from "../src/atlas/types.ts";

function fixture(id = "first"): Exploration {
  return {
    id,
    root: { id: "Q1", label: "A thinker", description: "An explored idea" },
    createdAt: "2026-10-26T12:00:00.000Z",
    mode: "wikidata",
    warnings: ["Coverage is incomplete."],
    categories: [
      {
        id: "influenced-by",
        label: "Inspired by",
        description: "Wikidata statements may lack references.",
        nodes: [
          {
            id: "node-1",
            entityId: "Q2",
            label: "An earlier thinker",
            description: "A documented connection",
            evidence: "claim",
            explanation:
              "An unreferenced Wikidata statement, not independently verified.",
            sources: [
              { label: "Statement", url: "https://www.wikidata.org/wiki/Q1" },
            ],
            children: [
              {
                id: "node-2",
                label: "Another idea",
                description: "A possible parallel",
                evidence: "inferred",
                explanation:
                  "Similarity only; influence has not been established.",
                sources: [],
              },
            ],
          },
        ],
      },
    ],
  };
}

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem(key: string) {
      return data.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      data.set(key, value);
    },
  };
}

test("valid explorations round trip without touching existing notebook data", () => {
  const storage = memoryStorage({
    "strategic-notebook": "existing private notes",
  });
  writeSaved(storage, [fixture()]);
  assert.deepEqual(loadSaved(storage), { items: [fixture()] });
  assert.equal(
    storage.data.get("strategic-notebook"),
    "existing private notes",
  );
});

test("missing, malformed, and nested invalid data are handled without writes", () => {
  assert.deepEqual(loadSaved(memoryStorage()), { items: [] });
  const nested = fixture();
  (
    nested.categories[0].nodes[0].children![0] as unknown as {
      sources: unknown;
    }
  ).sources = null;
  for (const original of ["{oops", "null", "{}", JSON.stringify([nested])]) {
    const storage = memoryStorage({
      [STORAGE_KEY]: original,
      unrelated: "keep",
    });
    const result = loadSaved(storage);
    assert.deepEqual(result.items, []);
    assert.match(result.warning!, /preserved/);
    assert.equal(storage.data.get(STORAGE_KEY), original);
    assert.equal(storage.data.get("unrelated"), "keep");
  }
});

test("unknown JSON properties cannot contaminate deserialized objects", () => {
  const raw = JSON.stringify([fixture()]).replace(
    '"root":{',
    '"__proto__":{"polluted":true},"root":{"constructor":{"prototype":{"polluted":true}},',
  );
  const result = loadSaved(memoryStorage({ [STORAGE_KEY]: raw }));
  assert.equal(result.warning, undefined);
  assert.equal(Object.hasOwn(result.items[0], "__proto__"), false);
  assert.equal(Object.hasOwn(result.items[0].root, "constructor"), false);
  assert.equal(({} as { polluted?: boolean }).polluted, undefined);
});

test("storage read failures and quota failures are surfaced without losing data", () => {
  const readResult = loadSaved({
    getItem() {
      throw new Error("SecurityError");
    },
  });
  assert.deepEqual(readResult.items, []);
  assert.match(readResult.warning!, /could not be read/);
  const existing = [fixture("old")];
  const updated = saveExploration(existing, fixture("new"));
  assert.throws(
    () =>
      writeSaved(
        {
          setItem() {
            throw new Error("QuotaExceededError");
          },
        },
        updated,
      ),
    /QuotaExceededError/,
  );
  assert.equal(existing.length, 1);
  assert.deepEqual(
    updated.map((item) => item.id),
    ["new", "old"],
  );
});

test("upsert is pure, removes duplicates of the saved ID, and preserves other maps", () => {
  const existing = [fixture("old"), fixture("first"), fixture("first")];
  const replacement = { ...fixture("first"), warnings: ["Updated"] };
  const updated = saveExploration(existing, replacement);
  assert.deepEqual(
    updated.map((item) => item.id),
    ["first", "old"],
  );
  assert.equal(updated[0], replacement);
  assert.equal(updated[1], existing[0]);
  assert.equal(existing.length, 3);
});

test("duplicate stored IDs are invalid; capacity never silently evicts saved maps", () => {
  const storage = memoryStorage({
    [STORAGE_KEY]: JSON.stringify([fixture(), fixture()]),
  });
  assert.match(loadSaved(storage).warning!, /invalid/);
  const full = Array.from({ length: 30 }, (_, index) => fixture(String(index)));
  assert.throws(() => saveExploration(full, fixture("new")), /up to 30/);
  assert.equal(full.length, 30);
  assert.equal(saveExploration(full, fixture("0")).length, 30);
});

test("size limits and invalid writes preserve the previous saved collection", () => {
  const oversized = " ".repeat(5_000_001);
  const oversizedStorage = memoryStorage({ [STORAGE_KEY]: oversized });
  assert.match(loadSaved(oversizedStorage).warning!, /preserved/);
  assert.equal(oversizedStorage.data.get(STORAGE_KEY), oversized);
  const storage = memoryStorage({
    [STORAGE_KEY]: JSON.stringify([fixture("keep")]),
  });
  const before = storage.data.get(STORAGE_KEY);
  const invalid = fixture("invalid");
  invalid.root.label = "x".repeat(1_001);
  assert.throws(() => writeSaved(storage, [invalid]), /Invalid text/);
  assert.equal(storage.data.get(STORAGE_KEY), before);
  assert.throws(
    () =>
      writeSaved(
        storage,
        Array.from({ length: 31 }, (_, index) => fixture(String(index))),
      ),
    /Invalid list/,
  );
  assert.equal(storage.data.get(STORAGE_KEY), before);
});

test("invalid evidence, unsafe sources, duplicate nodes, and excessive nesting are rejected", () => {
  const invalidStatus = fixture();
  (
    invalidStatus.categories[0].nodes[0] as unknown as { evidence: string }
  ).evidence = "certain";
  const unsafeSource = fixture();
  unsafeSource.categories[0].nodes[0].sources[0].url = "javascript:alert(1)";
  const duplicateNode = fixture();
  duplicateNode.categories[0].nodes[0].children![0].id = "node-1";
  const deep = fixture();
  let parent = deep.categories[0].nodes[0];
  for (let index = 0; index < 35; index++) {
    const child = {
      id: `deep-${index}`,
      label: "Deep",
      description: "",
      evidence: "claim" as const,
      explanation: "",
      sources: [],
    };
    parent.children = [child];
    parent = child;
  }
  for (const invalid of [invalidStatus, unsafeSource, duplicateNode, deep]) {
    assert.deepEqual(
      loadSaved(memoryStorage({ [STORAGE_KEY]: JSON.stringify([invalid]) }))
        .items,
      [],
    );
  }
});

test("Markdown exports recurse and retain categories, evidence, missing data, warnings, and time", () => {
  const value = fixture();
  value.categories.push({
    id: "challenge",
    label: "Challenged",
    description: "No challenge statements found.",
    nodes: [],
  });
  const markdown = exportMarkdown(value);
  for (const expected of [
    "## Inspired by",
    "## Challenged",
    "Another idea",
    "evidence: claim",
    "evidence: inferred",
    "No challenge statements found",
    "coverage gap",
    "Warnings",
    "Mode: wikidata",
    "2026",
    "not proof of influence",
    "https://www.wikidata.org/wiki/Q1",
  ]) {
    assert.ok(markdown.includes(expected), expected);
  }
  assert.deepEqual(JSON.parse(exportJSON(value)), value);
});

test("Markdown escapes user content and omits active and unsupported URLs", () => {
  const value = fixture();
  value.root.label =
    "# injected\n<script>alert(1)</script> [click](javascript:alert(1)) **bold**";
  value.categories[0].label = "x\n# injected heading";
  value.categories[0].nodes[0].sources = [
    { label: "<script> & [link]", url: "javascript:alert(1)" },
    { label: "Data URI", url: "data:text/html,<script>alert(1)</script>" },
    { label: "Relative", url: "//example.com/test" },
    { label: "Credentials", url: "https://name:secret@example.com" },
    { label: "Whitespace", url: "https://exa\nmple.com" },
    { label: "Safe", url: "https://example.com/a_(b)?q=[c]&other=<d>" },
    { label: "HTTP", url: "http://example.org/reference" },
  ];
  const markdown = exportMarkdown(value);
  assert.ok(markdown.includes("\\# injected &lt;script&gt;"));
  assert.ok(markdown.includes("\\[click\\]\\(javascript:alert\\(1\\)\\)"));
  assert.ok(markdown.includes("\\*\\*bold\\*\\*"));
  assert.ok(!markdown.includes("<script>"));
  assert.ok(!markdown.includes("\n# injected"));
  assert.ok(!markdown.includes("](<javascript:"));
  assert.ok(!markdown.includes("](<data:"));
  assert.ok(!markdown.includes("name:secret"));
  assert.ok(
    markdown.includes("https://example.com/a_%28b%29?q=%5Bc%5D&other=%3Cd%3E"),
  );
  assert.ok(markdown.includes("http://example.org/reference"));
  assert.equal(
    (markdown.match(/unsafe or unsupported URL omitted/g) ?? []).length,
    5,
  );
});
