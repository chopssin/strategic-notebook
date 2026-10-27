import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Bookmark,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Compass,
  ExternalLink,
  GitBranch,
  History,
  Layers,
  LoaderCircle,
  Plus,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import type {
  Candidate,
  Category,
  ConceptNode,
  Exploration,
} from "./atlas/types";
import { startingMap } from "./atlas/example";
import { exploreEntity, searchEntities } from "./atlas/wikidata";
import { searchWorks, type ScholarlyWork } from "./atlas/openalex";
import { loadSaved, saveExploration, writeSaved } from "./atlas/storage";
import { exportJSON, exportMarkdown } from "./atlas/export";

const evidenceLabels = {
  documented: "Documented",
  claim: "Wikidata claim",
  inferred: "Inferred similarity",
};
const evidenceDescriptions = {
  documented:
    "A supporting reference is attached. Read it to assess what the relationship actually supports.",
  claim:
    "Wikidata records this relationship, but a supporting reference was not available. Treat it as an unverified claim.",
  inferred:
    "An interpretation based on thematic similarity. It is not a documented connection or proof of influence.",
};
const safeLink = (url: string) => {
  try {
    return ["https:", "http:"].includes(new URL(url).protocol);
  } catch {
    return false;
  }
};
const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";

function readSaved() {
  try {
    return loadSaved(window.localStorage);
  } catch {
    return {
      items: [] as Exploration[],
      warning:
        "Browser storage is unavailable. You can still explore and export maps.",
    };
  }
}

function replaceNode(
  nodes: ConceptNode[],
  id: string,
  children: ConceptNode[],
): ConceptNode[] {
  return nodes.map((node) =>
    node.id === id
      ? { ...node, children }
      : {
          ...node,
          ...(node.children
            ? { children: replaceNode(node.children, id, children) }
            : {}),
        },
  );
}
function findNode(
  categories: Category[],
  id: string | null,
): ConceptNode | undefined {
  function find(nodes: ConceptNode[]): ConceptNode | undefined {
    for (const node of nodes) {
      if (node.id === id) return node;
      const nested = find(node.children || []);
      if (nested) return nested;
    }
  }
  return categories.flatMap((category) => {
    const node = find(category.nodes);
    return node ? [node] : [];
  })[0];
}
function countNodes(nodes: ConceptNode[]): number {
  return nodes.reduce(
    (total, node) => total + 1 + countNodes(node.children || []),
    0,
  );
}
function download(map: Exploration, format: "md" | "json") {
  const content = format === "md" ? exportMarkdown(map) : exportJSON(map);
  const blob = new Blob([content], {
    type:
      format === "md"
        ? "text/markdown;charset=utf-8"
        : "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `ideagraph-${map.root.label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.${format}`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Atlas() {
  const [initialSaved] = useState(readSaved);
  const [saved, setSaved] = useState(initialSaved.items);
  const [removed, setRemoved] = useState<Exploration | null>(null);
  const [journey, setJourney] = useState({ items: [startingMap], index: 0 });
  const map = journey.items[journey.index];
  const mapRef = useRef(map);
  mapRef.current = map;
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"structured" | "ai">("structured");
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [searched, setSearched] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(
    new Set(["influenced", "thematic-parallels"]),
  );
  const [selectedId, setSelectedId] = useState<string | null>(
    "arendt-heidegger",
  );
  const selected = findNode(map.categories, selectedId);
  const [pendingNode, setPendingNode] = useState<string | null>(null);
  const [nodeError, setNodeError] = useState<Record<string, string>>({});
  const [works, setWorks] = useState<ScholarlyWork[] | null>(null);
  const [worksError, setWorksError] = useState("");
  const [worksBusy, setWorksBusy] = useState(false);
  const [scholarQuery, setScholarQuery] = useState(map.root.label);
  const [methodOpen, setMethodOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<"md" | "json" | null>(null);
  const [exportMessage, setExportMessage] = useState("");
  const exportDialog = useRef<HTMLDialogElement>(null);
  const request = useRef<AbortController | null>(null);
  const retryAction = useRef<() => void>(() => {});
  const scholarshipRequest = useRef<AbortController | null>(null);
  const selectionPanel = useRef<HTMLElement>(null);

  useEffect(() => {
    if (exportFormat) exportDialog.current?.showModal();
    else exportDialog.current?.close();
  }, [exportFormat]);

  useEffect(
    () => () => {
      request.current?.abort();
      scholarshipRequest.current?.abort();
    },
    [],
  );
  useEffect(() => {
    scholarshipRequest.current?.abort();
    setWorks(null);
    setWorksError("");
    setWorksBusy(false);
    setScholarQuery(map.root.label);
  }, [map.id, map.root.label]);

  function cancel() {
    request.current?.abort();
    request.current = null;
    setBusy("");
    setPendingNode(null);
  }
  function resetView(next: Exploration) {
    cancel();
    setSelectedId(next.categories.flatMap((c) => c.nodes)[0]?.id || null);
    setCollapsed(new Set());
    setNodeError({});
    setCandidates(null);
    setError("");
    setNotice("");
  }
  function openMap(next: Exploration) {
    resetView(next);
    setJourney((previous) => ({
      items: [...previous.items.slice(0, previous.index + 1), next].slice(-40),
      index: Math.min(previous.index + 1, 39),
    }));
  }
  function go(index: number) {
    resetView(journey.items[index]);
    setJourney((previous) => ({ ...previous, index }));
  }
  function toggle(id: string) {
    setCollapsed((previous) => {
      const next = new Set(previous);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  async function search(value = query) {
    if (mode === "ai") return;
    retryAction.current = () => void search(value);
    const trimmed = value.trim();
    if (!trimmed) {
      setError("Enter a thinker, idea, or a few keywords to search Wikidata.");
      return;
    }
    cancel();
    const controller = new AbortController();
    request.current = controller;
    setBusy("Finding matching Wikidata entries…");
    setError("");
    setCandidates(null);
    setSearched(trimmed);
    try {
      const matches = await searchEntities(trimmed, controller.signal);
      if (!controller.signal.aborted) setCandidates(matches);
    } catch (err) {
      if (!controller.signal.aborted) setError(errorText(err));
    } finally {
      if (request.current === controller) {
        setBusy("");
        request.current = null;
      }
    }
  }
  async function recenter(candidate: Candidate) {
    retryAction.current = () => void recenter(candidate);
    cancel();
    const controller = new AbortController();
    request.current = controller;
    setBusy(`Building a sourced tree for ${candidate.label}…`);
    setError("");
    try {
      const next = await exploreEntity(candidate, controller.signal);
      if (!controller.signal.aborted) openMap(next);
    } catch (err) {
      if (!controller.signal.aborted) setError(errorText(err));
    } finally {
      if (request.current === controller) {
        setBusy("");
        request.current = null;
      }
    }
  }
  async function expand(node: ConceptNode, depth: number) {
    if (node.children) {
      toggle(node.id);
      return;
    }
    if (!node.entityId || depth >= 3) return;
    cancel();
    const controller = new AbortController();
    request.current = controller;
    const currentMapId = map.id;
    setPendingNode(node.id);
    setBusy(`Expanding ${node.label}…`);
    setNodeError((previous) => ({ ...previous, [node.id]: "" }));
    try {
      const branch = await exploreEntity(
        { id: node.entityId, label: node.label, description: node.description },
        controller.signal,
      );
      if (controller.signal.aborted || mapRef.current.id !== currentMapId)
        return;
      const children = branch.categories
        .flatMap((category) =>
          category.nodes.map((child) => ({
            ...child,
            id: crypto.randomUUID(),
            description: `${category.label} · ${child.description}`,
          })),
        )
        .slice(0, 12);
      setJourney((previous) => ({
        ...previous,
        items: previous.items.map((item, index) =>
          index === previous.index && item.id === currentMapId
            ? {
                ...item,
                categories: item.categories.map((category) => ({
                  ...category,
                  nodes: replaceNode(category.nodes, node.id, children),
                })),
                warnings: [
                  ...new Set([
                    ...item.warnings,
                    ...branch.warnings.map(
                      (warning) => `${node.label}: ${warning}`,
                    ),
                    "Nested expansions show up to 12 connections per node. Recenter for the full available map.",
                  ]),
                ],
              }
            : item,
        ),
      }));
      setCollapsed((previous) => {
        const next = new Set(previous);
        next.delete(node.id);
        return next;
      });
    } catch (err) {
      if (!controller.signal.aborted)
        setNodeError((previous) => ({
          ...previous,
          [node.id]: errorText(err),
        }));
    } finally {
      if (request.current === controller) {
        setBusy("");
        setPendingNode(null);
        request.current = null;
      }
    }
  }
  function save() {
    if (initialSaved.warning) {
      setNotice(`${initialSaved.warning} Export this map to keep a copy.`);
      return;
    }
    try {
      const items = saveExploration(saved, map);
      writeSaved(window.localStorage, items);
      setSaved(items);
      setNotice("Map saved in this browser, including loaded branches.");
    } catch (err) {
      setNotice(`Could not save: ${errorText(err)} Export a copy instead.`);
    }
  }
  function removeSaved(item: Exploration) {
    try {
      const items = saved.filter((entry) => entry.id !== item.id);
      writeSaved(window.localStorage, items);
      setSaved(items);
      setRemoved(item);
      setNotice(`Removed ${item.root.label} from saved explorations.`);
    } catch (err) {
      setNotice(`Could not remove map: ${errorText(err)}`);
    }
  }
  function undoRemove() {
    if (!removed) return;
    try {
      const items = saveExploration(saved, removed);
      writeSaved(window.localStorage, items);
      setSaved(items);
      setRemoved(null);
      setNotice("Saved exploration restored.");
    } catch (err) {
      setNotice(`Could not restore map: ${errorText(err)}`);
    }
  }
  async function loadScholarship() {
    scholarshipRequest.current?.abort();
    const controller = new AbortController();
    scholarshipRequest.current = controller;
    setWorksBusy(true);
    setWorksError("");
    setWorks(null);
    try {
      const result = await searchWorks(scholarQuery, controller.signal);
      if (!controller.signal.aborted) setWorks(result);
    } catch (err) {
      if (!controller.signal.aborted) setWorksError(errorText(err));
    } finally {
      if (scholarshipRequest.current === controller) setWorksBusy(false);
    }
  }
  function renderNodes(nodes: ConceptNode[], depth = 0) {
    return (
      <ul className="node-list">
        {nodes.map((node) => (
          <li key={node.id}>
            <div
              className={`node-row ${selectedId === node.id ? "is-selected" : ""}`}
            >
              <button
                className="node-select"
                onClick={() => {
                  setSelectedId(node.id);
                  if (window.matchMedia("(max-width: 900px)").matches)
                    selectionPanel.current?.scrollIntoView({ block: "start" });
                }}
                aria-pressed={selectedId === node.id}
              >
                <span className={`evidence-dot ${node.evidence}`} />
                <span>
                  <strong>{node.label}</strong>
                  <small>{node.description}</small>
                </span>
              </button>
              <button
                className="icon-button branch-button"
                title={
                  depth >= 3
                    ? "Recenter to explore further"
                    : node.children
                      ? `Toggle connections for ${node.label}`
                      : `Expand ${node.label}`
                }
                aria-label={
                  node.children
                    ? `Toggle connections for ${node.label}`
                    : `Expand ${node.label}`
                }
                aria-expanded={node.children ? !collapsed.has(node.id) : false}
                disabled={!!busy || !node.entityId || depth >= 3}
                onClick={() => void expand(node, depth)}
              >
                {pendingNode === node.id ? (
                  <LoaderCircle size={15} className="spin" />
                ) : node.children ? (
                  collapsed.has(node.id) ? (
                    <ChevronRight size={16} />
                  ) : (
                    <ChevronDown size={16} />
                  )
                ) : (
                  <Plus size={15} />
                )}
              </button>
            </div>
            {nodeError[node.id] && (
              <p className="inline-error" role="alert">
                {nodeError[node.id]} Use + to retry.
              </p>
            )}
            {node.children &&
              !collapsed.has(node.id) &&
              (node.children.length ? (
                renderNodes(node.children, depth + 1)
              ) : (
                <p className="branch-empty">
                  No supported connections were returned. Recenter to review
                  evidence gaps.
                </p>
              ))}
          </li>
        ))}
      </ul>
    );
  }
  const totalNodes = map.categories.reduce(
    (total, category) => total + countNodes(category.nodes),
    0,
  );
  const isSaved = saved.some((item) => item.id === map.id);

  return (
    <div className="atlas-shell">
      <dialog
        ref={exportDialog}
        className="export-dialog"
        aria-labelledby="export-title"
        onCancel={() => setExportFormat(null)}
      >
        {exportFormat && (
          <>
            <div className="export-dialog-heading">
              <h2 id="export-title">
                Export {exportFormat === "md" ? "Markdown" : "JSON"}
              </h2>
              <button
                autoFocus
                className="icon-button"
                aria-label="Close export"
                onClick={() => setExportFormat(null)}
              >
                <X size={18} />
              </button>
            </div>
            <p>
              Your map includes its evidence, sources, and loaded branches.
              Download a file or copy the text.
            </p>
            <textarea
              aria-label="Export content"
              readOnly
              value={
                exportFormat === "md" ? exportMarkdown(map) : exportJSON(map)
              }
            />
            <div className="export-dialog-actions">
              <button
                className="secondary-button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(
                      exportFormat === "md"
                        ? exportMarkdown(map)
                        : exportJSON(map),
                    );
                    setExportMessage("Copied to clipboard.");
                  } catch {
                    setExportMessage(
                      "Clipboard access is unavailable. Select and copy the text above.",
                    );
                  }
                }}
              >
                Copy text
              </button>
              <button
                className="primary-button"
                onClick={() => {
                  download(map, exportFormat);
                  setExportMessage(
                    "Download requested. If your browser blocks it, copy the text above.",
                  );
                }}
              >
                <ArrowDownToLine size={15} /> Download .{exportFormat}
              </button>
            </div>
            <p role="status" className="export-status">
              {exportMessage}
            </p>
          </>
        )}
      </dialog>
      <a href="#main" className="skip-link">
        Skip to exploration
      </a>
      <aside className="sidebar" aria-label="Workspace navigation">
        <a className="brand" href={import.meta.env.BASE_URL}>
          <span className="brand-mark">
            <GitBranch size={23} />
          </span>
          <span>
            Idea<span className="brand-second">Graph</span>
          </span>
        </a>
        <div className="workspace-label">A WORKSPACE FOR CURIOSITY</div>
        <button
          className="sidebar-primary"
          onClick={() => {
            openMap(startingMap);
            setQuery("");
            setMode("structured");
          }}
        >
          <Compass size={18} /> Explore ideas <ArrowUpRight size={15} />
        </button>
        <div className="side-section">
          <h2>
            <Bookmark size={14} /> Saved explorations{" "}
            <span>{saved.length}</span>
          </h2>
          {saved.length ? (
            saved.map((item) => (
              <div key={item.id} className="side-map-row">
                <button
                  className={`side-map ${item.id === map.id ? "active" : ""}`}
                  onClick={() => openMap(item)}
                >
                  <span className="mini-dot" />
                  <span>
                    {item.root.label}
                    <small>
                      {item.mode === "example" ? "Curated map" : "Wikidata map"}
                    </small>
                  </span>
                </button>
                <button
                  className="remove-map"
                  aria-label={`Remove saved ${item.root.label}`}
                  onClick={() => removeSaved(item)}
                >
                  <X size={12} />
                </button>
              </div>
            ))
          ) : (
            <p className="side-empty">
              Keep a map here.
              <br />
              Follow its threads later.
            </p>
          )}
        </div>
        <div className="side-section history-section">
          <h2>
            <History size={14} /> This session
          </h2>
          {journey.items.map((item, index) => (
            <button
              key={`${item.id}-${index}`}
              className={`history-item ${index === journey.index ? "current" : ""}`}
              onClick={() => go(index)}
            >
              <span>{String(index + 1).padStart(2, "0")}</span>
              {item.root.label}
            </button>
          ))}
        </div>
        <div className="sidebar-footer">
          <button onClick={() => setMethodOpen(!methodOpen)}>
            <CircleHelp size={17} /> How the atlas works
          </button>
          <a href={`${import.meta.env.BASE_URL}legacy/`}>
            <BookOpen size={16} /> Original notebook <ArrowUpRight size={13} />
          </a>
          <div className="edition">
            <span /> STATIC EDITION · 01
          </div>
        </div>
      </aside>
      <main id="main" className="main-content">
        <header className="topbar">
          <span>
            <Compass size={15} /> Explore <span className="slash">/</span> Your
            atlas
          </span>
          <button
            className="quiet-button"
            onClick={() => setMethodOpen(!methodOpen)}
          >
            <CircleHelp size={15} /> About the evidence
          </button>
        </header>
        <section className="intro">
          <div className="eyebrow">FOLLOW AN IDEA. FIND A NEW PERSPECTIVE.</div>
          <h1>
            Nothing is thought
            <br className="desktop-break" /> <em>in isolation.</em>
          </h1>
          <p>
            Trace the people, ideas, and conversations behind a thought.
            <br className="desktop-break" /> Start somewhere. See where it takes
            you.
          </p>
        </section>
        <section className="search-section" aria-label="Start an exploration">
          <div
            className="search-modes"
            role="group"
            aria-label="Exploration mode"
          >
            <button
              aria-pressed={mode === "structured"}
              className={mode === "structured" ? "selected" : ""}
              onClick={() => {
                cancel();
                setMode("structured");
                setError("");
              }}
            >
              <GitBranch size={14} /> Wikidata explorer
            </button>
            <button
              aria-pressed={mode === "ai"}
              className={mode === "ai" ? "selected" : ""}
              onClick={() => {
                cancel();
                setMode("ai");
                setCandidates(null);
                setError("");
              }}
            >
              <Sparkles size={14} /> AI interpretation{" "}
              <span>Not connected</span>
            </button>
          </div>
          <form
            className="search-form"
            onSubmit={(event) => {
              event.preventDefault();
              void search();
            }}
          >
            <Search size={22} />
            <input
              aria-label="Name, keywords, or sentence"
              maxLength={240}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={
                mode === "structured"
                  ? "A thinker, an idea, a few keywords…"
                  : "What idea would you like to untangle?"
              }
            />
            <button
              className="primary-button"
              type="submit"
              disabled={mode === "ai" || !!busy}
            >
              Explore <ArrowRight size={17} />
            </button>
          </form>
          {mode === "structured" ? (
            <div className="search-hint">
              <span>Search Wikidata by name or keywords.</span>
              <div>
                Try{" "}
                <button
                  onClick={() => {
                    setQuery("Simone de Beauvoir");
                    void search("Simone de Beauvoir");
                  }}
                >
                  Simone de Beauvoir
                </button>
                <button
                  onClick={() => {
                    setQuery("Stoicism");
                    void search("Stoicism");
                  }}
                >
                  Stoicism
                </button>
                <button
                  onClick={() => {
                    setQuery("Cybernetics");
                    void search("Cybernetics");
                  }}
                >
                  Cybernetics
                </button>
              </div>
            </div>
          ) : (
            <div className="ai-notice" role="status">
              <Sparkles size={18} />
              <div>
                <strong>AI generation needs a connected backend.</strong>
                <p>
                  This static edition cannot interpret sentences or generate
                  AI-organized trees. No AI request or hidden keyword fallback
                  will run. You can choose structured lookup to explore Wikidata
                  records.
                </p>
              </div>
            </div>
          )}
          {busy && (
            <div className="loading-banner" role="status">
              <LoaderCircle className="spin" size={17} />
              {busy}
              <button onClick={cancel}>Cancel</button>
            </div>
          )}
          {error && (
            <div className="error-banner" role="alert">
              {error}
              <button onClick={() => retryAction.current()}>Retry</button>
            </div>
          )}
          {candidates && (
            <div className="candidate-panel">
              <div className="candidate-heading">
                <div>
                  <strong>
                    {candidates.length
                      ? "Which one did you mean?"
                      : "No matching entries"}
                  </strong>
                  <p>
                    {candidates.length
                      ? `Wikidata matches for “${searched}”. Choose the intended subject.`
                      : `No Wikidata entries matched “${searched}”. Try a shorter name or switch to a specific concept. This does not mean the idea has no connections.`}
                  </p>
                </div>
                <button
                  className="icon-button"
                  aria-label="Close search results"
                  onClick={() => setCandidates(null)}
                >
                  <X size={17} />
                </button>
              </div>
              {candidates.map((candidate) => (
                <button
                  className="candidate"
                  key={candidate.id}
                  disabled={!!busy}
                  onClick={() => void recenter(candidate)}
                >
                  <span>
                    <strong>{candidate.label}</strong>
                    <small>
                      {candidate.description || "No description provided"}
                    </small>
                  </span>
                  <span className="entity-id">
                    {candidate.id} <ArrowRight size={15} />
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
        {methodOpen && (
          <section className="method-panel">
            <div>
              <h2>A connection is a claim. Follow its evidence.</h2>
              <button
                className="icon-button"
                aria-label="Close evidence guide"
                onClick={() => setMethodOpen(false)}
              >
                <X size={18} />
              </button>
            </div>
            <p>
              Curated maps contain reviewed source summaries. Live maps use
              explicit Wikidata properties; a reference attached to a statement
              does not make the claim indisputable. “Inspired by” represents
              Wikidata’s broad “influenced by” property, not necessarily
              agreement or personal contact.
            </p>
            <p>
              Responded to, challenged, and thematic parallels need additional
              interpretation. When that evidence is unavailable, the map says
              so. OpenAlex returns scholarly search matches: citing someone,
              sharing a topic, or having a similar name never proves influence.
            </p>
            <p>
              Saved maps stay in this browser. Searches go directly to Wikidata
              or OpenAlex. No AI service is connected, and no API key is
              requested by this page.
            </p>
          </section>
        )}
        {initialSaved.warning && (
          <p className="error-banner" role="alert">
            {initialSaved.warning} Existing stored data has not been changed.
            Export maps to keep a copy.
          </p>
        )}
        {notice && (
          <p className="notice" role="status">
            <Check size={16} />
            {notice}
            {removed && (
              <button className="undo-button" onClick={undoRemove}>
                Undo removal
              </button>
            )}
            <button
              className="icon-button"
              aria-label="Dismiss notification"
              onClick={() => setNotice("")}
            >
              <X size={15} />
            </button>
          </p>
        )}
        <section className="atlas-workspace" aria-label="Concept tree">
          <div className="map-toolbar">
            <div className="history-controls">
              <button
                className="icon-button"
                aria-label="Previous exploration"
                disabled={journey.index === 0}
                onClick={() => go(journey.index - 1)}
              >
                <ArrowLeft size={17} />
              </button>
              <button
                className="icon-button"
                aria-label="Next exploration"
                disabled={journey.index === journey.items.length - 1}
                onClick={() => go(journey.index + 1)}
              >
                <ArrowRight size={17} />
              </button>
              <span className="toolbar-divider" />
              <span className="map-source">
                <span
                  className={
                    map.mode === "example" ? "example-dot" : "live-dot"
                  }
                />
                {map.mode === "example"
                  ? "Curated starting map"
                  : "Live Wikidata map"}
              </span>
            </div>
            <div className="map-actions">
              <button className="quiet-button" onClick={save}>
                <Bookmark size={15} />
                {isSaved ? "Update saved map" : "Save map"}
              </button>
              <details className="export-menu">
                <summary>
                  <ArrowDownToLine size={15} /> Export <ChevronDown size={13} />
                </summary>
                <div>
                  <button
                    onClick={() => {
                      setExportFormat("md");
                      setExportMessage("");
                    }}
                  >
                    Markdown (.md)
                  </button>
                  <button
                    onClick={() => {
                      setExportFormat("json");
                      setExportMessage("");
                    }}
                  >
                    JSON (.json)
                  </button>
                </div>
              </details>
            </div>
          </div>
          <div className="map-body">
            <div className="tree-pane">
              <div className="root-node">
                <div className="root-icon">
                  <GitBranch size={23} />
                </div>
                <div>
                  <span className="root-kicker">YOUR STARTING POINT</span>
                  <h2>{map.root.label}</h2>
                  <p>{map.root.description}</p>
                </div>
                <a
                  className="icon-button"
                  aria-label={`View ${map.root.label} on Wikidata`}
                  href={`https://www.wikidata.org/wiki/${map.root.id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ArrowUpRight size={19} />
                </a>
              </div>
              <div className="tree-caption">
                <span>
                  {totalNodes} connections · {map.categories.length} branches
                </span>
                <button
                  onClick={() =>
                    setCollapsed(new Set(map.categories.map((c) => c.id)))
                  }
                >
                  Collapse all
                </button>
                <button onClick={() => setCollapsed(new Set())}>
                  Open all
                </button>
              </div>
              <div className="category-tree">
                {map.categories.map((category, index) => (
                  <section
                    key={category.id}
                    className={`category category-${index % 5}`}
                  >
                    <button
                      className="category-toggle"
                      aria-expanded={!collapsed.has(category.id)}
                      onClick={() => toggle(category.id)}
                    >
                      {collapsed.has(category.id) ? (
                        <ChevronRight size={16} />
                      ) : (
                        <ChevronDown size={16} />
                      )}
                      <span className="category-marker" />
                      <strong>{category.label}</strong>
                      <span className="count">{category.nodes.length}</span>
                    </button>
                    {!collapsed.has(category.id) && (
                      <div className="category-content">
                        {category.nodes.length ? (
                          <>
                            <p className="category-description">
                              {category.description}
                            </p>
                            {renderNodes(category.nodes)}
                          </>
                        ) : (
                          <p className="empty-category">
                            {category.description ||
                              "No supported relationships are available in this category."}
                          </p>
                        )}
                      </div>
                    )}
                  </section>
                ))}
              </div>
              <div className="tree-footnote">
                <Plus size={13} /> Expand a node to follow its connections.
                Select its name to inspect the evidence.
              </div>
            </div>
            <aside
              className="evidence-pane"
              ref={selectionPanel}
              aria-label="Connection details"
            >
              <div className="panel-eyebrow">
                <Layers size={15} /> CONNECTION NOTES
              </div>
              {selected ? (
                <>
                  <span className={`evidence-badge ${selected.evidence}`}>
                    <span />
                    {evidenceLabels[selected.evidence]}
                  </span>
                  <h3>{selected.label}</h3>
                  <p className="node-description">{selected.description}</p>
                  <div className="evidence-rule" />
                  <h4>Why this connection?</h4>
                  <p className="explanation">{selected.explanation}</p>
                  <p className="evidence-caveat">
                    {evidenceDescriptions[selected.evidence]}
                  </p>
                  <h4>Follow the source</h4>
                  <ul className="source-list">
                    {selected.sources
                      .filter((source) => safeLink(source.url))
                      .map((source, index) => (
                        <li key={`${source.url}-${index}`}>
                          <a href={source.url} target="_blank" rel="noreferrer">
                            <BookOpen size={16} />
                            <span>
                              {source.label}
                              <small>{new URL(source.url).hostname}</small>
                            </span>
                            <ExternalLink size={13} />
                          </a>
                        </li>
                      ))}
                  </ul>
                  {!selected.sources.length && (
                    <p className="muted">No supporting source was supplied.</p>
                  )}
                  <button
                    className="recenter-button"
                    disabled={!selected.entityId || !!busy}
                    onClick={() =>
                      selected.entityId &&
                      void recenter({
                        id: selected.entityId,
                        label: selected.label,
                        description: selected.description,
                      })
                    }
                  >
                    <Compass size={16} /> Make this the starting point{" "}
                    <ArrowRight size={15} />
                  </button>
                  <p className="recenter-hint">
                    Loads a new Wikidata map. Your path stays in session
                    history.
                  </p>
                </>
              ) : (
                <div className="evidence-empty">
                  <GitBranch size={30} />
                  <h3>Every thread has a story.</h3>
                  <p>
                    Select a connection to see its explanation, evidence, and
                    sources.
                  </p>
                </div>
              )}
            </aside>
          </div>
          <div className="map-footer">
            <span>
              <span className="evidence-dot documented" /> Documented
            </span>
            <span>
              <span className="evidence-dot claim" /> Unreferenced claim
            </span>
            <span>
              <span className="evidence-dot inferred" /> Inferred similarity
            </span>
            <span className="snapshot-date">
              Snapshot ·{" "}
              {new Date(map.createdAt).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </span>
          </div>
        </section>
        {!!map.warnings.length && (
          <details className="coverage-notes">
            <summary>
              <CircleHelp size={15} /> Coverage & missing evidence{" "}
              <span>{map.warnings.length}</span>
              <ChevronDown size={14} />
            </summary>
            <ul>
              {map.warnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          </details>
        )}
        <section className="scholarship">
          <div className="scholarship-intro">
            <div>
              <span className="eyebrow">KEEP READING</span>
              <h2>A trail into the literature.</h2>
              <p>
                Search OpenAlex for scholarly works. Matches are reading leads,
                not evidence of influence.
              </p>
            </div>
            <BookOpen size={34} strokeWidth={1} />
          </div>
          <form
            className="scholar-search"
            onSubmit={(event) => {
              event.preventDefault();
              void loadScholarship();
            }}
          >
            <input
              aria-label="Search scholarly works"
              maxLength={200}
              value={scholarQuery}
              onChange={(event) => setScholarQuery(event.target.value)}
            />
            <button
              className="secondary-button"
              disabled={worksBusy || !scholarQuery.trim()}
            >
              {worksBusy ? (
                <LoaderCircle className="spin" size={15} />
              ) : (
                <Search size={15} />
              )}{" "}
              Search OpenAlex
            </button>
          </form>
          {worksBusy && (
            <p role="status">Searching scholarly titles and abstracts…</p>
          )}
          {worksError && (
            <p className="inline-error" role="alert">
              {worksError}
            </p>
          )}
          {works && !works.length && (
            <p>No matching works were returned. Try more specific keywords.</p>
          )}
          {works && works.length > 0 && (
            <ul className="works-list">
              {works.map((work) => (
                <li key={work.id}>
                  <span className="work-year">{work.year || "n.d."}</span>
                  <div>
                    <a href={work.url} target="_blank" rel="noreferrer">
                      {work.title} <ArrowUpRight size={14} />
                    </a>
                    <p>{work.authors.join(", ") || "Authors not supplied"}</p>
                    <small>
                      {work.citationCount.toLocaleString()} citations ·
                      bibliographic metadata only
                    </small>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="provider-note">
            Public API access is limited; rate limits or service outages may
            interrupt searches. No secret key is stored in this page.
          </p>
        </section>
        <footer className="page-footer">
          <span>
            IdeaGraph <span className="footer-dot">·</span> A little curiosity
            goes a long way.
          </span>
          <span>
            Structured data from{" "}
            <a href="https://www.wikidata.org" target="_blank" rel="noreferrer">
              Wikidata
            </a>{" "}
            &{" "}
            <a href="https://openalex.org" target="_blank" rel="noreferrer">
              OpenAlex
            </a>
          </span>
        </footer>
      </main>
    </div>
  );
}
