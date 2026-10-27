import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { exploreEntity, searchEntities } from "../src/atlas/wikidata.ts";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const itemSnak = (id: string) => ({
  snaktype: "value",
  datavalue: { value: { id } },
});
const claim = (
  owner: string,
  id: string,
  references: unknown[] = [],
  extra = {},
) => ({
  id: `${owner}$statement-${id}`,
  rank: "normal",
  mainsnak: itemSnak(id),
  references,
  ...extra,
});
const entity = (id: string, label: string, claims = {}) => ({
  id,
  labels: { en: { value: label } },
  descriptions: { en: { value: `${label} description` } },
  claims,
});
const root = { id: "Q1", label: "Root", description: "Root description" };
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });

function installFixture(
  entities: Record<string, unknown>,
  inverse: string[] = [],
  failReverse = false,
) {
  const requests: URL[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    requests.push(url);
    if (url.hostname === "query.wikidata.org") {
      if (failReverse) return json({}, 503);
      return json({
        results: {
          bindings: inverse.map((id) => ({
            item: { value: `http://www.wikidata.org/entity/${id}` },
          })),
        },
      });
    }
    assert.equal(url.searchParams.get("origin"), "*");
    assert.equal(url.searchParams.get("action"), "wbgetentities");
    const ids = url.searchParams.get("ids")!.split("|");
    return json({
      entities: Object.fromEntries(
        ids.map((id) => [id, entities[id] || { id, missing: "" }]),
      ),
    });
  };
  return requests;
}

test("search retains ambiguity, uses CORS, rejects invalid IDs, and deduplicates candidates", async () => {
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.searchParams.get("action"), "wbsearchentities");
    assert.equal(url.searchParams.get("search"), "James");
    assert.equal(url.searchParams.get("origin"), "*");
    assert.equal(init?.credentials, "omit");
    return json({
      search: [
        { id: "Q1", label: "William James", description: "philosopher" },
        { id: "Q2", label: "Henry James", description: "writer" },
        { id: "Q1", label: "duplicate" },
        { id: "javascript:alert(1)", label: "unsafe" },
      ],
    });
  };
  assert.deepEqual(await searchEntities("  James "), [
    { id: "Q1", label: "William James", description: "philosopher" },
    { id: "Q2", label: "Henry James", description: "writer" },
  ]);
});

test("source attribution and direct/reverse influence retain direction and evidence quality", async () => {
  const source = {
    snaks: {
      P854: [
        {
          snaktype: "value",
          datavalue: { value: "https://example.org/biography" },
        },
      ],
      P248: [itemSnak("Q9")],
    },
  };
  const entities = {
    Q1: entity("Q1", "Root", {
      P737: [claim("Q1", "Q2", [source])],
      P135: [claim("Q1", "Q4")],
      P31: [claim("Q1", "Q5")],
    }),
    Q2: entity("Q2", "Predecessor"),
    Q3: entity("Q3", "Successor", { P737: [claim("Q3", "Q1")] }),
    Q4: entity("Q4", "A movement"),
    Q9: entity("Q9", "A biography"),
  };
  const requests = installFixture(entities, ["Q3"]);
  const result = await exploreEntity(root);
  const inspired = result.categories.find(
    (category) => category.id === "inspired-by",
  )!.nodes[0];
  const influenced = result.categories.find(
    (category) => category.id === "influenced",
  )!.nodes[0];
  assert.equal(inspired.entityId, "Q2");
  assert.equal(inspired.evidence, "documented");
  assert.match(
    inspired.explanation,
    /Root is recorded as influenced or inspired by Predecessor/,
  );
  assert.match(inspired.explanation, /not been independently verified/);
  assert.ok(
    inspired.sources.some(
      (source) => source.url === "https://example.org/biography",
    ),
  );
  assert.ok(
    inspired.sources.some(
      (source) => source.label === "Stated in: A biography",
    ),
  );
  assert.ok(
    inspired.sources.some((source) =>
      source.url.endsWith("/Q1#Q1$statement-Q2"),
    ),
  );
  assert.equal(influenced.entityId, "Q3");
  assert.equal(influenced.evidence, "claim");
  assert.match(
    influenced.explanation,
    /Successor is recorded as influenced or inspired by Root/,
  );
  assert.ok(influenced.sources[0].url.endsWith("/Q3#Q3$statement-Q1"));
  assert.equal(
    result.categories.find((category) => category.id === "movement")!.nodes[0]
      .evidence,
    "claim",
  );
  assert.ok(
    !result.categories.some((category) => category.id === "instance-of"),
  );
  assert.ok(
    requests.some((url) =>
      url.searchParams.get("query")?.includes("/entity/Q1"),
    ),
  );
});

test("unsafe URLs cannot make a claim documented or enter sources", async () => {
  const invalid = [
    "javascript:alert(1)",
    "data:text/html,hello",
    "file:///tmp/test",
    "https://user:password@example.org/x",
    "http://localhost/test",
    "http://127.0.0.1/test",
    "http://192.168.1.10/test",
  ];
  const reference = {
    snaks: {
      P854: invalid.map((value) => ({
        snaktype: "value",
        datavalue: { value },
      })),
    },
  };
  installFixture({
    Q1: entity("Q1", "Root", { P737: [claim("Q1", "Q2", [reference])] }),
    Q2: entity("Q2", "Other"),
  });
  const result = await exploreEntity(root);
  const node = result.categories[0].nodes[0];
  assert.equal(node.evidence, "claim");
  assert.deepEqual(
    node.sources.map((source) => source.label),
    ["Wikidata statement"],
  );
});

test("non-human inputs use available properties without inventing influences or parallels", async () => {
  installFixture({
    Q1: entity("Q1", "Root", {
      P279: [claim("Q1", "Q2")],
      P2579: [claim("Q1", "Q3")],
      P527: [claim("Q1", "Q4", [], { rank: "deprecated" })],
    }),
    Q2: entity("Q2", "Broader concept"),
    Q3: entity("Q3", "Discipline"),
  });
  const result = await exploreEntity(root);
  assert.deepEqual(
    result.categories.map((category) => category.id),
    ["subclass-of", "studied-by"],
  );
  assert.ok(
    result.warnings.some((warning) =>
      warning.includes("Influence has not been inferred"),
    ),
  );
  assert.ok(
    result.warnings.some((warning) =>
      warning.includes("not generated in this static edition"),
    ),
  );
});

test("missing claims explain lack of evidence and never produce fabricated nodes", async () => {
  installFixture({ Q1: entity("Q1", "Root") });
  const result = await exploreEntity(root);
  assert.deepEqual(result.categories, []);
  assert.ok(
    result.warnings.some((warning) =>
      warning.includes("No supported relationships"),
    ),
  );
  assert.ok(
    result.warnings.some((warning) =>
      warning.includes("not evidence that a relationship does not exist"),
    ),
  );
});

test("reverse lookup failures preserve direct evidence and disclose a missing branch", async () => {
  installFixture(
    {
      Q1: entity("Q1", "Root", { P737: [claim("Q1", "Q2")] }),
      Q2: entity("Q2", "Other"),
    },
    [],
    true,
  );
  const result = await exploreEntity(root);
  assert.equal(result.categories[0].nodes[0].entityId, "Q2");
  assert.ok(
    result.warnings.some(
      (warning) =>
        warning.includes("lookup failed") && warning.includes("HTTP 503"),
    ),
  );
  assert.ok(
    !result.warnings.some((warning) => warning.startsWith("No reverse")),
  );
});

test("reverse search hits are not used as evidence without confirming current claims", async () => {
  installFixture(
    {
      Q1: entity("Q1", "Root"),
      Q2: entity("Q2", "Unconfirmed", { P737: [claim("Q2", "Q3")] }),
    },
    ["Q2"],
  );
  const result = await exploreEntity(root);
  assert.ok(
    !result.categories.some((category) => category.id === "influenced"),
  );
  assert.ok(
    result.warnings.some((warning) =>
      warning.includes("could not be confirmed"),
    ),
  );
});

test("large relationship sets are capped with an explicit completeness warning", async () => {
  const claims = Array.from({ length: 12 }, (_, index) =>
    claim("Q1", `Q${index + 10}`),
  );
  installFixture({ Q1: entity("Q1", "Root", { P279: claims }) });
  const result = await exploreEntity(root);
  assert.equal(result.categories[0].nodes.length, 8);
  assert.ok(
    result.warnings.some((warning) => warning.includes("first 8 statements")),
  );
});

test("timeout aborts the pending fetch and gives an actionable error", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  globalThis.fetch = async (_input, init) =>
    new Promise((_resolve, reject) => {
      init!.signal!.addEventListener(
        "abort",
        () => reject(new DOMException("Aborted", "AbortError")),
        { once: true },
      );
    });
  const pending = searchEntities("unfinished");
  const rejection = assert.rejects(pending, /within 12 seconds/);
  t.mock.timers.tick(12_001);
  await rejection;
});

test("caller cancellation remains cancellation rather than an unavailable-service warning", async () => {
  const controller = new AbortController();
  controller.abort();
  let requested = false;
  globalThis.fetch = async () => {
    requested = true;
    return json({});
  };
  await assert.rejects(
    searchEntities("test", controller.signal),
    (error) => error instanceof DOMException && error.name === "AbortError",
  );
  assert.equal(requested, false);
});

test("HTTP rate limiting and malformed responses do not masquerade as empty evidence", async () => {
  globalThis.fetch = async () => json({}, 429);
  await assert.rejects(searchEntities("test"), /rate limiting/);
  globalThis.fetch = async () => json({ unexpected: true });
  await assert.rejects(searchEntities("test"), /incomplete search response/);
});

test("direct entity IDs resolve and invalid exploration IDs never reach the network", async () => {
  installFixture({ Q1: entity("Q1", "An entity") });
  assert.equal((await searchEntities("q1"))[0].label, "An entity");
  await assert.rejects(
    exploreEntity({ ...root, id: "Q1> INJECT" }),
    /valid Wikidata result/,
  );
});
