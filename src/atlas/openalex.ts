/** Search matches are reading leads, never evidence that one thinker influenced another. */
export interface ScholarlyWork {
  id: string;
  title: string;
  year: number | null;
  authors: string[];
  url: string;
  doi?: string;
  citationCount: number;
}

const INVALID_RESPONSE =
  "OpenAlex returned an unexpected response. Try again later.";
const REQUEST_TIMEOUT_MS = 12_000;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function httpsUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password)
      return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

function parseWork(value: unknown): ScholarlyWork {
  if (!isRecord(value)) throw new Error(INVALID_RESPONSE);
  const id = httpsUrl(value.id);
  if (
    !id ||
    !/^https:\/\/openalex\.org\/W[1-9]\d*$/.test(id) ||
    typeof value.display_name !== "string" ||
    !value.display_name.trim() ||
    !Array.isArray(value.authorships) ||
    typeof value.cited_by_count !== "number" ||
    !Number.isSafeInteger(value.cited_by_count) ||
    value.cited_by_count < 0 ||
    (value.publication_year !== null &&
      (typeof value.publication_year !== "number" ||
        !Number.isInteger(value.publication_year) ||
        value.publication_year < 1 ||
        value.publication_year > 9999))
  ) {
    throw new Error(INVALID_RESPONSE);
  }

  const authors = value.authorships.flatMap((authorship) => {
    if (!isRecord(authorship) || !isRecord(authorship.author)) return [];
    const name = authorship.author.display_name;
    return typeof name === "string" && name.trim() ? [name.trim()] : [];
  });
  const possibleDoi = httpsUrl(value.doi);
  const doi =
    possibleDoi && new URL(possibleDoi).hostname === "doi.org"
      ? possibleDoi
      : undefined;
  const landingPage = isRecord(value.primary_location)
    ? httpsUrl(value.primary_location.landing_page_url)
    : undefined;
  return {
    id,
    title: value.display_name.trim(),
    year: value.publication_year as number | null,
    authors,
    url: doi ?? landingPage ?? id,
    ...(doi ? { doi } : {}),
    citationCount: value.cited_by_count,
  };
}

/**
 * Explicit, anonymous title/abstract search; no AI interpretation or inferred relationships.
 * OpenAlex's anonymous quota is shared by a visitor's public IP address.
 */
export async function searchWorks(
  query: string,
  signal?: AbortSignal,
): Promise<ScholarlyWork[]> {
  const search = query.trim();
  if (!search)
    throw new Error("Enter a name or some keywords to search scholarly works.");

  const url = new URL("https://api.openalex.org/works");
  url.searchParams.set("search.title_and_abstract", search);
  url.searchParams.set("per_page", "6");
  url.searchParams.set(
    "select",
    "id,display_name,publication_year,authorships,doi,cited_by_count,primary_location",
  );
  if (url.href.length > 3900) {
    throw new Error(
      "This scholarly search is too long. Try a shorter name or a few keywords.",
    );
  }
  signal?.throwIfAborted();
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", abort, { once: true });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  try {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Accept: "application/json" },
        credentials: "omit",
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) throw error;
      throw new Error(
        "Could not reach OpenAlex. Check your connection and try again.",
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        "OpenAlex requires authenticated access for this request. A backend with an OpenAlex API key must be configured; this static site cannot store a secret key.",
      );
    }
    if (response.status === 429) {
      throw new Error(
        "OpenAlex has reached its request limit for your network. Wait and try again later; the anonymous daily budget is shared by your IP address.",
      );
    }
    if (response.status === 400) {
      throw new Error(
        "OpenAlex could not process this search. Try a shorter name or simpler keywords.",
      );
    }
    if (!response.ok) {
      throw new Error(
        `OpenAlex is unavailable (HTTP ${response.status}). Try again later.`,
      );
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      if (controller.signal.aborted) throw error;
      throw new Error(INVALID_RESPONSE);
    }
    if (!isRecord(body) || !Array.isArray(body.results))
      throw new Error(INVALID_RESPONSE);
    const works = body.results.slice(0, 6).map(parseWork);
    return works.filter(
      (work, index) => works.findIndex((item) => item.id === work.id) === index,
    );
  } catch (error) {
    if (signal?.aborted)
      throw (
        signal.reason ?? new DOMException("Search cancelled.", "AbortError")
      );
    if (timedOut)
      throw new Error("OpenAlex took too long to respond. Please try again.");
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}
