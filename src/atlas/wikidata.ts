import type {
  Candidate,
  Category,
  ConceptNode,
  Exploration,
  Source,
} from "./types.ts";

const API = "https://www.wikidata.org/w/api.php";
const QUERY_API = "https://query.wikidata.org/sparql";
const TIMEOUT_MS = 12_000;
const CATEGORY_LIMIT = 8;
const isEntityId = (value: unknown): value is string =>
  typeof value === "string" && /^Q[1-9]\d*$/.test(value);

interface Snak {
  snaktype?: string;
  datavalue?: { value?: unknown };
}
interface Claim {
  id?: string;
  rank?: string;
  mainsnak?: Snak;
  references?: Array<{ snaks?: Record<string, Snak[]> }>;
  qualifiers?: Record<string, Snak[]>;
}
interface Entity {
  id: string;
  missing?: string | boolean;
  labels?: Record<string, { value: string }>;
  descriptions?: Record<string, { value: string }>;
  claims?: Record<string, Claim[]>;
}
type EntityMap = Record<string, Entity>;
interface Relation {
  property: string;
  id: string;
  label: string;
  description: string;
  verb: string;
}
const RELATIONS: Relation[] = [
  {
    property: "P737",
    id: "inspired-by",
    label: "Inspired by",
    description: "Explicit “influenced by” statements in Wikidata (P737).",
    verb: "is recorded as influenced or inspired by",
  },
  {
    property: "P279",
    id: "subclass-of",
    label: "Broader concepts",
    description:
      "Concepts classified as a broader kind of this subject (P279).",
    verb: "is a subclass of",
  },
  {
    property: "P361",
    id: "part-of",
    label: "Part of",
    description: "Larger systems or wholes containing this subject (P361).",
    verb: "is part of",
  },
  {
    property: "P527",
    id: "parts",
    label: "Constituent ideas & parts",
    description: "Explicit components of this subject (P527).",
    verb: "has the part",
  },
  {
    property: "P2579",
    id: "studied-by",
    label: "Studied by",
    description: "Disciplines that study this subject (P2579).",
    verb: "is studied by",
  },
  {
    property: "P101",
    id: "field",
    label: "Fields of work",
    description: "Fields associated with this subject’s work (P101).",
    verb: "has the field of work",
  },
  {
    property: "P135",
    id: "movement",
    label: "Movements",
    description:
      "Associated movements or schools (P135); membership is not evidence of influence.",
    verb: "is associated with the movement",
  },
  {
    property: "P106",
    id: "occupation",
    label: "Practices & occupations",
    description:
      "Recorded occupations (P106); shared occupation is not evidence of influence.",
    verb: "has the occupation",
  },
  {
    property: "P31",
    id: "instance-of",
    label: "Kinds & classifications",
    description: "Recorded classifications (P31).",
    verb: "is an instance of",
  },
];

function abortError(): DOMException {
  return new DOMException("The request was cancelled.", "AbortError");
}

async function requestJson<T>(url: URL, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) throw abortError();
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, TIMEOUT_MS);
  try {
    const response = await fetch(url.toString(), {
      signal: controller.signal,
      headers: { Accept: "application/json" },
      credentials: "omit",
    });
    if (!response.ok) {
      if (response.status === 429)
        throw new Error(
          "Wikidata is rate limiting requests. Please try again shortly.",
        );
      throw new Error(
        `Wikidata returned HTTP ${response.status}. Please try again.`,
      );
    }
    const data = await response.json();
    if (data.error)
      throw new Error(
        "Wikidata could not complete this request. Please try again.",
      );
    return data as T;
  } catch (error) {
    if (signal?.aborted) throw abortError();
    if (timedOut)
      throw new Error(
        "Wikidata did not respond within 12 seconds. Please try again.",
      );
    if (error instanceof TypeError)
      throw new Error(
        "Could not reach Wikidata. Check your connection and try again.",
      );
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

function apiUrl(params: Record<string, string>): URL {
  const url = new URL(API);
  url.search = new URLSearchParams({
    format: "json",
    origin: "*",
    ...params,
  }).toString();
  return url;
}

async function loadEntities(
  ids: string[],
  signal?: AbortSignal,
  includeClaims = true,
): Promise<EntityMap> {
  const uniqueIds = [...new Set(ids.filter(isEntityId))];
  if (!uniqueIds.length) return {};
  const batches: string[][] = [];
  for (let i = 0; i < uniqueIds.length; i += 50)
    batches.push(uniqueIds.slice(i, i + 50));
  const results = await Promise.all(
    batches.map(async (batch) => {
      const data = await requestJson<{ entities?: EntityMap }>(
        apiUrl({
          action: "wbgetentities",
          ids: batch.join("|"),
          props: includeClaims
            ? "labels|descriptions|claims"
            : "labels|descriptions",
          languages: "en",
          languagefallback: "1",
        }),
        signal,
      );
      if (!data.entities || typeof data.entities !== "object")
        throw new Error(
          "Wikidata returned an incomplete entity response. Please try again.",
        );
      return data.entities;
    }),
  );
  return Object.assign({}, ...results);
}

function candidateFrom(entity: Entity, fallback?: Candidate): Candidate {
  return {
    id: entity.id,
    label: entity.labels?.en?.value || fallback?.label || entity.id,
    description:
      entity.descriptions?.en?.value ||
      fallback?.description ||
      "No English description is available in Wikidata.",
  };
}

/** Label/alias lookup only. This deliberately does not pretend to interpret a sentence with AI. */
export async function searchEntities(
  query: string,
  signal?: AbortSignal,
): Promise<Candidate[]> {
  const text = query.trim();
  if (!text) return [];
  if (text.length > 300)
    throw new Error(
      "Use a name or a few keywords, up to 300 characters. Sentence interpretation requires the AI backend.",
    );
  if (isEntityId(text.toUpperCase())) {
    const id = text.toUpperCase();
    const entities = await loadEntities([id], signal, false);
    return entities[id] && entities[id].missing === undefined
      ? [candidateFrom(entities[id])]
      : [];
  }
  const data = await requestJson<{
    search?: Array<{ id?: unknown; label?: unknown; description?: unknown }>;
  }>(
    apiUrl({
      action: "wbsearchentities",
      search: text,
      language: "en",
      uselang: "en",
      type: "item",
      limit: "8",
    }),
    signal,
  );
  if (!Array.isArray(data.search))
    throw new Error(
      "Wikidata returned an incomplete search response. Please try again.",
    );
  const seen = new Set<string>();
  return data.search.flatMap((item) => {
    if (!isEntityId(item.id) || seen.has(item.id)) return [];
    seen.add(item.id);
    return [
      {
        id: item.id,
        label: typeof item.label === "string" ? item.label : item.id,
        description:
          typeof item.description === "string"
            ? item.description
            : "No English description is available in Wikidata.",
      },
    ];
  });
}

function targetId(snak?: Snak): string | undefined {
  if (snak?.snaktype !== "value") return undefined;
  const value = snak.datavalue?.value;
  if (!value || typeof value !== "object" || !("id" in value)) return undefined;
  return isEntityId(value.id) ? value.id : undefined;
}

function usableClaims(entity: Entity, property: string): Claim[] {
  return (entity.claims?.[property] || []).filter(
    (claim) => claim.rank !== "deprecated" && targetId(claim.mainsnak),
  );
}

/** Only navigable public HTTP(S) links are allowed in evidence exports or the interface. */
function safeSourceUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return undefined;
    const host = url.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host.endsWith(".local") ||
      !host.includes(".") ||
      host.startsWith("[")
    )
      return undefined;
    if (
      /^(127|10|0)\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^169\.254\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    )
      return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

function sourceIds(claims: Claim[]): string[] {
  return claims.flatMap((claim) =>
    (claim.references || []).flatMap((reference) =>
      (reference.snaks?.P248 || []).flatMap((snak) => {
        const id = targetId(snak);
        return id ? [id] : [];
      }),
    ),
  );
}

function sourcesFor(
  claim: Claim,
  ownerId: string,
  property: string,
  entities: EntityMap,
): { sources: Source[]; referenced: boolean } {
  const sources: Source[] = [];
  for (const reference of claim.references || []) {
    for (const snak of reference.snaks?.P854 || []) {
      const url = safeSourceUrl(snak.datavalue?.value);
      if (url)
        sources.push({ label: `Reference: ${new URL(url).hostname}`, url });
    }
    for (const snak of reference.snaks?.P248 || []) {
      const id = targetId(snak);
      if (id)
        sources.push({
          label: `Stated in: ${entities[id]?.labels?.en?.value || id}`,
          url: `https://www.wikidata.org/wiki/${id}`,
        });
    }
  }
  const referenced = sources.length > 0;
  const anchor =
    claim.id && /^Q[1-9]\d*\$[A-Za-z0-9-]+$/.test(claim.id)
      ? claim.id
      : property;
  sources.push({
    label: "Wikidata statement",
    url: `https://www.wikidata.org/wiki/${ownerId}#${anchor}`,
  });
  return {
    sources: [
      ...new Map(sources.map((source) => [source.url, source])).values(),
    ],
    referenced,
  };
}

function nodeFor(
  claim: Claim,
  relation: Relation,
  root: Candidate,
  entities: EntityMap,
  inverseOwner?: Entity,
): ConceptNode {
  const id = inverseOwner?.id || targetId(claim.mainsnak)!;
  const entity = inverseOwner || entities[id];
  const label = entity?.labels?.en?.value || id;
  const { sources, referenced } = sourcesFor(
    claim,
    inverseOwner?.id || root.id,
    relation.property,
    entities,
  );
  const assertion = inverseOwner
    ? `${label} is recorded as influenced or inspired by ${root.label} (Wikidata P737).`
    : `${root.label} ${relation.verb} ${label} (Wikidata ${relation.property}).`;
  const qualification =
    claim.qualifiers && Object.keys(claim.qualifiers).length
      ? " The statement has qualifiers; inspect it for context and scope."
      : "";
  return {
    id: `${root.id}:${inverseOwner ? "influenced" : relation.id}:${id}:${claim.id || ""}`,
    entityId: id,
    label,
    description:
      entity?.descriptions?.en?.value ||
      "No English description is available in Wikidata.",
    evidence: referenced ? "documented" : "claim",
    explanation: `${assertion} ${referenced ? "Wikidata attaches a source to this relationship; the source has not been independently verified here." : "No usable reference URL or “stated in” source is attached to this claim. Treat it as an unverified Wikidata claim."}${qualification}`,
    sources,
  };
}

async function findInfluenced(
  id: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const query = `SELECT DISTINCT ?item WHERE {
    ?item <http://www.wikidata.org/prop/P737> ?statement .
    ?statement <http://www.wikidata.org/prop/statement/P737> <http://www.wikidata.org/entity/${id}> ;
      <http://wikiba.se/ontology#rank> ?rank .
    FILTER(?rank != <http://wikiba.se/ontology#DeprecatedRank>)
  } LIMIT ${CATEGORY_LIMIT + 1}`;
  const url = new URL(QUERY_API);
  url.search = new URLSearchParams({ query, format: "json" }).toString();
  const data = await requestJson<{
    results?: { bindings?: Array<{ item?: { value?: string } }> };
  }>(url, signal);
  if (!Array.isArray(data.results?.bindings))
    throw new Error(
      "Wikidata returned an incomplete reverse-influence response.",
    );
  return [
    ...new Set(
      data.results.bindings.flatMap((binding) => {
        const match = binding.item?.value?.match(
          /^https?:\/\/www\.wikidata\.org\/entity\/(Q[1-9]\d*)$/,
        );
        return match ? [match[1]] : [];
      }),
    ),
  ];
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "The service is currently unavailable.";
}

/** A bounded evidence tree from explicit Wikidata properties, never generated similarity. */
export async function exploreEntity(
  candidate: Candidate,
  signal?: AbortSignal,
): Promise<Exploration> {
  if (!isEntityId(candidate.id))
    throw new Error("Choose a valid Wikidata result before exploring.");
  const initial = await loadEntities([candidate.id], signal);
  const entity = initial[candidate.id];
  if (!entity || entity.missing !== undefined)
    throw new Error(
      "This Wikidata item is no longer available. Search for another result.",
    );
  const root = candidateFrom(entity, candidate);
  const warnings = [
    "This is a bounded Wikidata snapshot, not a complete map of relationships. Missing entries are not evidence that a relationship does not exist.",
  ];
  const selected = RELATIONS.map((relation) => {
    // “Human” adds no conceptual context to a thinker tree.
    const claims = usableClaims(entity, relation.property).filter(
      (claim) =>
        relation.property !== "P31" || targetId(claim.mainsnak) !== "Q5",
    );
    if (claims.length > CATEGORY_LIMIT)
      warnings.push(
        `“${relation.label}” shows the first ${CATEGORY_LIMIT} statements; additional statements exist in Wikidata.`,
      );
    return { relation, claims: claims.slice(0, CATEGORY_LIMIT) };
  });
  const allClaims = selected.flatMap((item) => item.claims);
  const targetIds = allClaims.flatMap(
    (claim) => targetId(claim.mainsnak) || [],
  );
  const [relatedResult, inverseResult] = await Promise.allSettled([
    loadEntities([...targetIds, ...sourceIds(allClaims)], signal, false),
    findInfluenced(root.id, signal),
  ]);
  if (signal?.aborted) throw abortError();
  let entities: EntityMap = { ...initial };
  if (relatedResult.status === "fulfilled")
    entities = { ...entities, ...relatedResult.value };
  else
    warnings.push(
      `Some related labels could not be loaded. Entity IDs and statement links are still available. ${errorMessage(relatedResult.reason)}`,
    );
  const categories: Category[] = selected
    .filter((item) => item.claims.length)
    .map(({ relation, claims }) => ({
      id: relation.id,
      label: relation.label,
      description: relation.description,
      nodes: claims.map((claim) => nodeFor(claim, relation, root, entities)),
    }));
  if (inverseResult.status === "fulfilled") {
    if (inverseResult.value.length > CATEGORY_LIMIT)
      warnings.push(
        `“Influenced” shows at most ${CATEGORY_LIMIT} items. The reverse lookup is capped and may not include every recorded relationship.`,
      );
    if (inverseResult.value.length) {
      try {
        const inverseEntities = await loadEntities(
          inverseResult.value.slice(0, CATEGORY_LIMIT),
          signal,
        );
        entities = { ...entities, ...inverseEntities };
        const nodes = inverseResult.value
          .slice(0, CATEGORY_LIMIT)
          .flatMap((id) => {
            const owner = inverseEntities[id];
            if (!owner || owner.missing !== undefined) return [];
            return usableClaims(owner, "P737")
              .filter((claim) => targetId(claim.mainsnak) === root.id)
              .slice(0, 1)
              .map((claim) =>
                nodeFor(claim, RELATIONS[0], root, entities, owner),
              );
          });
        if (nodes.length)
          categories.splice(categories[0]?.id === "inspired-by" ? 1 : 0, 0, {
            id: "influenced",
            label: "Influenced",
            description:
              "Other items that explicitly name this subject in an “influenced by” statement (reverse P737).",
            nodes,
          });
        if (nodes.length < Math.min(inverseResult.value.length, CATEGORY_LIMIT))
          warnings.push(
            "Some reverse-influence results could not be confirmed in current Wikidata statements and were omitted.",
          );
      } catch (error) {
        if (signal?.aborted) throw abortError();
        warnings.push(
          `“Influenced” evidence could not be loaded; this is not an absence of influence. ${errorMessage(error)}`,
        );
      }
    } else
      warnings.push(
        "No reverse “influenced by” statements were returned. Wikidata may be incomplete or its query index may lag behind edits.",
      );
  } else
    warnings.push(
      `The reverse “influenced by” lookup failed; that branch is unavailable, not empty evidence. ${errorMessage(inverseResult.reason)}`,
    );
  if (!categories.length)
    warnings.push(
      "No supported relationships were found for this item. Try another item or inspect its Wikidata page; this does not establish that it has no connections.",
    );
  if (!categories.some((category) => category.id === "inspired-by"))
    warnings.push(
      "No explicit “influenced by” statements were found on this item. Influence has not been inferred from shared topics or citations.",
    );
  warnings.push(
    "“Responded to”, “challenged”, and thematic parallels require interpretation and additional evidence. They are not generated in this static edition. AI interpretation is not connected; OpenAlex reading leads are separate from this tree.",
  );
  return {
    id: crypto.randomUUID(),
    root,
    categories,
    createdAt: new Date().toISOString(),
    warnings,
    mode: "wikidata",
  };
}
