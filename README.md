# IdeaGraph

Explore relationships between ideas and thinkers through collapsible, source-linked trees. This is the **static Wikidata edition** of IdeaGraph, evolving the existing Strategic Notebook React + TypeScript project.

**No OpenAI API key or backend is required for this edition.** Wikidata searches and relationship lookups are live. OpenAlex provides a separate, optional scholarly reading search. AI sentence interpretation is explicitly unavailable; the app never presents keyword search or the curated starting map as AI generation.

## What works

- Search arbitrary names, concepts, keywords, or Wikidata Q IDs. Select the intended entity from ambiguity candidates.
- Inspect direct and reverse “influenced by” statements, including the direction of influence.
- Build appropriate branches from available properties: broader concepts, parts, fields, movements, classifications, occupations, and disciplines.
- Expand a node in place, collapse branches, or recenter the map on a node. Move backward and forward through the current session.
- Inspect the source and explanation for each connection. Referenced statements and unreferenced claims have distinct badges.
- Save up to 30 exploration snapshots in the current browser, including expanded branches. Remove a saved map with an undo option.
- Preview, copy, or download the complete current map as Markdown or JSON, retaining sources, evidence labels, warnings, and loaded branches.
- Search OpenAlex scholarly titles and abstracts independently. Search matches and citation counts are reading leads, never proof of influence or authorship.
- Use the interface on desktop and mobile, including keyboard navigation, labeled controls, loading/cancel/retry states, and empty results.

The opening Hannah Arendt map is a small, clearly labeled **curated example**, with summaries supported by the [Stanford Encyclopedia of Philosophy](https://plato.stanford.edu/entries/arendt/). New searches use live Wikidata; they are not restricted to example names.

## Preservation and repository history

The repository remains [`chopssin/strategic-notebook`](https://github.com/chopssin/strategic-notebook) to preserve existing URLs and deployment infrastructure. The product name is IdeaGraph. The review branch is `ideagraph-static`; it does not deploy over the current site before review and merge.

- `src/data.ts` remains unchanged: all original forecast data is preserved.
- The original notebook UI and styles are retained in `src/legacy/`.
- `/strategic-notebook/legacy/` serves the original notebook after deployment.
- No Git history is rewritten.
- IdeaGraph only uses its own local-storage key. The internal key `concept-atlas:saved:v1` is intentionally retained for compatibility with the initial Concept Atlas name. Existing unrelated storage is never cleared. Invalid saved data is left untouched and reported; export remains available.

## Run locally

Requirements: Node.js **22.18 or later** and npm. The deployed CI uses Node 22.

```sh
npm ci
npm test
npm run dev
```

The development URL is normally `http://localhost:5173/strategic-notebook/`.

For the production build:

```sh
npm run build
npm run preview
```

Open `http://localhost:4173/strategic-notebook/`. The notebook archive is at `http://localhost:4173/strategic-notebook/legacy/`.

## Configuration and deployment

There are **no required environment variables or secrets** for the static edition. It makes anonymous public API requests from the browser:

- `https://www.wikidata.org/w/api.php` with `origin=*` for search and entity data.
- `https://query.wikidata.org/sparql` for reverse influence discovery; returned relationships are checked against entity statements before being displayed.
- `https://api.openalex.org/works` for optional title/abstract search.

The interface uses Google Fonts with system/Georgia fallbacks. Searches transmit their terms to the chosen public data service. Saved maps remain in the local browser; there is no cloud account or cross-device sync.

The existing GitHub Pages infrastructure is reused:

1. Open the pull request from `ideagraph-static` to `main` and review its checks.
2. The `Check IdeaGraph` workflow runs unit tests and the production build on the branch and pull request. It attaches a `dist` artifact for seven days; it does not publish a preview URL.
3. After review and merge, `Deploy GitHub Pages` runs tests, builds both pages, and deploys `dist`.
4. GitHub Pages must use **GitHub Actions** as its source (already configured for this repository).
5. The main page is `https://chopssin.github.io/strategic-notebook/`; the archive is the same URL plus `legacy/`.

`vite.config.ts` retains the base `/strategic-notebook/`. If you later rename the GitHub repository, update this base and the documentation together. A manual Pages workflow should only be run from `main`.

## Architecture

- `src/Atlas.tsx`: IdeaGraph interface, request cancellation, tree interaction, session history, and save/export controls.
- `src/atlas/wikidata.ts`: live entity search, relationship retrieval, references, and partial-failure handling.
- `src/atlas/openalex.ts`: isolated bibliographic search, safe links, cancellation, and service errors.
- `src/atlas/types.ts`: typed map, category, connection, and evidence model.
- `src/atlas/storage.ts`: validated, versioned browser persistence with explicit capacity/quota failures.
- `src/atlas/export.ts`: Markdown and JSON exports. Markdown escapes user-provided content and rejects unsafe links.
- `src/atlas/example.ts`: the attributed introductory map.
- `src/legacy/`, `legacy/index.html`, and `src/data.ts`: the original notebook and its data.

The atlas and notebook are separate Vite build entries, so the original notebook's chart library is not required to render IdeaGraph.

## Evidence policy and limits

- **Documented** means a reviewed source is attached in the curated example, or Wikidata supplies a usable reference URL / “stated in” reference for that statement. A source on Wikidata has not been independently evaluated by this app; the detail panel explicitly says so.
- **Wikidata claim** means an explicit statement was found without a usable supporting reference. It is not silently promoted to a documented fact.
- **Inferred similarity** is supported by the display/export model but is not generated in this edition. Shared topics, occupations, citations, and co-occurrence do not establish influence.
- “Inspired by” is a UI label for Wikidata's broader `P737` (“influenced by”) relation; it does not imply admiration, agreement, or personal contact.
- “Responded to”, “challenged”, and thematic parallels require interpretation and additional evidence. Apart from the reviewed example, this edition explains that those categories are unavailable instead of inventing their contents.
- Missing claims are missing coverage, not proof of no relationship. Live maps reflect current Wikidata coverage, are English-first, and may be sparse or uneven.
- Up to eight relations per category are shown. In-place expansion shows up to 12 connections at each node and allows three nested expansion levels; recentering allows continued exploration. Limits and partial failures are disclosed in coverage notes.
- Requests have a 12-second timeout. A reverse lookup failure preserves direct evidence and marks the missing coverage. Anonymous provider limits, CORS changes, or outages can interrupt live requests.
- OpenAlex anonymous access has limited shared-IP capacity. Higher-volume usage will need a backend and provider credentials; no secret should be embedded in a static bundle.
- Session navigation is in memory and resets on reload. Explicitly saved snapshots persist locally. JSON export is a portable record; importing it is not implemented yet.

## Deferred AI work

A future server-side service can interpret sentences, resolve entities, and organize retrieved evidence into richer trees. That phase requires server hosting and credentials, input validation, request/budget limits, and evidence validation. API keys must remain on the server. GitHub Pages cannot provide that server-side runtime. No placeholder AI endpoint is called in this version.

## Verification

`npm test` covers ambiguity, influence direction, source quality, unsafe links, partial outages, timeouts, cancellation, malformed responses, storage corruption/quota/capacity, recursive exports, and preservation of unrelated browser data. `npm run build` includes strict TypeScript checks and builds IdeaGraph plus the archived notebook.

Manual browser checks should include live search and candidate selection, expansion/recentering, history, save/reload/remove/undo, both exports, OpenAlex search, keyboard controls, mobile layout, and the legacy page. See the pull request for the checks actually completed on this branch.

Data-service references: [Wikidata access](https://www.wikidata.org/wiki/Wikidata:Data_access), [P737](https://www.wikidata.org/wiki/Property:P737), [CORS](https://www.mediawiki.org/wiki/API:Cross-site_requests), [OpenAlex authentication](https://help.openalex.org/api/authentication/), and [OpenAlex search](https://help.openalex.org/api/searching/).
