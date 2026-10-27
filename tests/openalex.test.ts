import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { searchWorks } from "../src/atlas/openalex.ts";

afterEach(() => mock.restoreAll());

const sample = {
  id: "https://openalex.org/W4206612101",
  display_name: "Spinoza",
  publication_year: 2008,
  authorships: [{ author: { display_name: "Michael Della Rocca" } }],
  doi: "https://doi.org/10.4324/9780203894583",
  cited_by_count: 273,
  primary_location: { landing_page_url: "https://publisher.example/book" },
};

function reply(body: unknown, status = 200) {
  return mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
  );
}

test("searches the exact supplied text in title/abstract and returns reading metadata", async () => {
  const fetch = reply({ results: [sample] });
  const works = await searchWorks("  Spinoza AND ethics  ");
  const [url, options] = fetch.mock.calls[0].arguments as unknown as [
    URL,
    RequestInit,
  ];
  assert.equal(url.origin, "https://api.openalex.org");
  assert.equal(
    url.searchParams.get("search.title_and_abstract"),
    "Spinoza AND ethics",
  );
  assert.equal(url.searchParams.get("per_page"), "6");
  assert.equal(url.searchParams.has("api_key"), false);
  assert.equal(url.searchParams.has("filter"), false);
  assert.equal(options.credentials, "omit");
  assert.deepEqual(works, [
    {
      id: sample.id,
      title: "Spinoza",
      year: 2008,
      authors: ["Michael Della Rocca"],
      url: sample.doi,
      doi: sample.doi,
      citationCount: 273,
    },
  ]);
});

test("citation data and matches never become influence claims or thinker authorship", async () => {
  reply({
    results: [
      {
        ...sample,
        referenced_works: ["https://openalex.org/W123"],
        influenced: "Spinoza",
      },
    ],
  });
  const [work] = await searchWorks("Spinoza");
  assert.deepEqual(work.authors, ["Michael Della Rocca"]);
  assert.equal(work.citationCount, 273);
  assert.equal("influenced" in work, false);
  assert.equal("referenced_works" in work, false);
});

test("uses safe HTTPS links and drops unsafe DOI and landing URLs", async () => {
  reply({
    results: [
      {
        ...sample,
        doi: "javascript:alert(1)",
        primary_location: {
          landing_page_url: "https://username:password@publisher.example/book",
        },
      },
    ],
  });
  const [work] = await searchWorks("Spinoza");
  assert.equal(work.url, sample.id);
  assert.equal(work.doi, undefined);
});

test("rejects spoofed DOI hosts and falls back to safe publisher links", async () => {
  reply({
    results: [{ ...sample, doi: "https://doi.org.evil.example/10.1/fake" }],
  });
  const [work] = await searchWorks("Spinoza");
  assert.equal(work.url, sample.primary_location.landing_page_url);
  assert.equal(work.doi, undefined);
});

test("permits missing year, authors and DOI without inventing metadata", async () => {
  reply({
    results: [
      {
        ...sample,
        publication_year: null,
        authorships: [],
        doi: null,
        primary_location: null,
      },
    ],
  });
  const [work] = await searchWorks("Spinoza");
  assert.equal(work.year, null);
  assert.deepEqual(work.authors, []);
  assert.equal(work.url, sample.id);
});

test("returns empty matches and enforces the six-result limit with duplicate removal", async () => {
  const fetch = reply({ results: [] });
  assert.deepEqual(await searchWorks("Unknown phrase"), []);
  fetch.mock.mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          results: Array.from({ length: 9 }, (_, index) => ({
            ...sample,
            id: `https://openalex.org/W${Math.max(index, 1)}`,
          })),
        }),
      ),
  );
  assert.equal((await searchWorks("Spinoza")).length, 5);
});

test("gives actionable credential, quota and service errors", async () => {
  const fetch = reply({}, 401);
  await assert.rejects(
    searchWorks("Spinoza"),
    /backend with an OpenAlex API key/,
  );
  fetch.mock.mockImplementation(
    async () => new Response("{}", { status: 403 }),
  );
  await assert.rejects(
    searchWorks("Spinoza"),
    /static site cannot store a secret/,
  );
  fetch.mock.mockImplementation(
    async () => new Response("{}", { status: 429 }),
  );
  await assert.rejects(searchWorks("Spinoza"), /daily budget is shared/);
  fetch.mock.mockImplementation(
    async () => new Response("{}", { status: 503 }),
  );
  await assert.rejects(searchWorks("Spinoza"), /HTTP 503/);
  fetch.mock.mockImplementation(
    async () => new Response("{}", { status: 400 }),
  );
  await assert.rejects(searchWorks("Spinoza"), /simpler keywords/);
});

test("rejects malformed responses instead of displaying missing evidence as empty results", async () => {
  const fetch = reply({ message: "wrong shape" });
  await assert.rejects(searchWorks("Spinoza"), /unexpected response/);
  for (const work of [
    null,
    { ...sample, id: "https://evil.example/W123" },
    { ...sample, cited_by_count: -1 },
    { ...sample, publication_year: "2008" },
    { ...sample, display_name: "" },
  ]) {
    fetch.mock.mockImplementation(
      async () => new Response(JSON.stringify({ results: [work] })),
    );
    await assert.rejects(searchWorks("Spinoza"), /unexpected response/);
  }
  fetch.mock.mockImplementation(async () => new Response("not JSON"));
  await assert.rejects(searchWorks("Spinoza"), /unexpected response/);
});

test("validates empty or excessively long input before requesting OpenAlex", async () => {
  const fetch = reply({ results: [] });
  await assert.rejects(searchWorks("   "), /Enter a name/);
  await assert.rejects(searchWorks("字".repeat(1000)), /too long/);
  assert.equal(fetch.mock.callCount(), 0);
});

test("explains network failures and preserves user cancellation", async () => {
  const fetch = mock.method(globalThis, "fetch", async () => {
    throw new TypeError("Failed to fetch");
  });
  await assert.rejects(searchWorks("Spinoza"), /Check your connection/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(searchWorks("Spinoza", controller.signal), {
    name: "AbortError",
  });
  assert.equal(fetch.mock.callCount(), 1);
});

test("cancels an active search without reporting it as a provider failure", async () => {
  mock.method(
    globalThis,
    "fetch",
    (_url: unknown, options: RequestInit) =>
      new Promise((_resolve, reject) => {
        options.signal!.addEventListener(
          "abort",
          () => reject(options.signal!.reason),
          { once: true },
        );
      }),
  );
  const controller = new AbortController();
  const request = searchWorks("Spinoza", controller.signal);
  controller.abort();
  await assert.rejects(request, { name: "AbortError" });
});

test("times out an unresponsive provider with a retry message", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  mock.method(
    globalThis,
    "fetch",
    (_url: unknown, options: RequestInit) =>
      new Promise((_resolve, reject) => {
        options.signal!.addEventListener(
          "abort",
          () => reject(options.signal!.reason),
          { once: true },
        );
      }),
  );
  const request = searchWorks("Spinoza");
  context.mock.timers.tick(12_000);
  await assert.rejects(request, /took too long/);
});
