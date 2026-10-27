import type { ConceptNode, Exploration } from "./types.ts";

// Each input is used as inline text, so embedded newlines cannot introduce blocks.
function escapeMarkdown(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[\\`*_{}\[\]()#+.!|~\-]/g, "\\$&");
}

function safeSourceUrl(value: string): string | undefined {
  try {
    if (/[\u0000-\u0020\u007f]/.test(value)) return undefined;
    const url = new URL(value);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password
    )
      return undefined;
    return url.href.replace(
      /[\\<>"'`()\[\]{}]/g,
      (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    );
  } catch {
    return undefined;
  }
}

function nodeLines(node: ConceptNode, depth = 0): string[] {
  const indent = "  ".repeat(depth);
  const detail = `${indent}  `;
  const lines = [
    `${indent}- **${escapeMarkdown(node.label)}** — evidence: ${escapeMarkdown(node.evidence)}`,
    `${detail}- Description: ${escapeMarkdown(node.description) || "No description available."}`,
    `${detail}- Evidence explanation: ${escapeMarkdown(node.explanation) || "No supporting explanation is available."}`,
  ];
  if (node.sources.length) {
    lines.push(`${detail}- Sources:`);
    for (const source of node.sources) {
      const url = safeSourceUrl(source.url);
      lines.push(
        `${detail}  - ${url ? `[${escapeMarkdown(source.label)}](<${url}>)` : `${escapeMarkdown(source.label)} (unsafe or unsupported URL omitted)`}`,
      );
    }
  } else {
    lines.push(
      `${detail}- Sources: none provided. This does not establish a documented relationship.`,
    );
  }
  for (const child of node.children ?? [])
    lines.push(...nodeLines(child, depth + 1));
  return lines;
}

export function exportMarkdown(exploration: Exploration): string {
  const lines = [
    `# IdeaGraph: ${escapeMarkdown(exploration.root.label)}`,
    "",
    escapeMarkdown(exploration.root.description) ||
      "No root description available.",
    "",
    `- Created: ${escapeMarkdown(exploration.createdAt)}`,
    `- Mode: ${escapeMarkdown(exploration.mode)}`,
    `- Root identifier: ${escapeMarkdown(exploration.root.id)}`,
    "",
    "A citation or thematic similarity is not proof of influence. Evidence labels and source limitations apply to each relationship.",
  ];
  if (exploration.warnings.length) {
    lines.push("", "## Warnings", "");
    for (const warning of exploration.warnings)
      lines.push(`- ${escapeMarkdown(warning)}`);
  }
  for (const category of exploration.categories) {
    lines.push(
      "",
      `## ${escapeMarkdown(category.label)}`,
      "",
      escapeMarkdown(category.description) ||
        "No category explanation available.",
      "",
    );
    if (!category.nodes.length)
      lines.push(
        "No relationships with sufficient evidence were retrieved for this category. This is a coverage gap, not proof that no relationship exists.",
      );
    for (const node of category.nodes) lines.push(...nodeLines(node));
  }
  if (!exploration.categories.length)
    lines.push(
      "",
      "No relationship categories were retrieved. Evidence is currently unavailable.",
    );
  return `${lines.join("\n")}\n`;
}

export function exportJSON(exploration: Exploration): string {
  return `${JSON.stringify(exploration, null, 2)}\n`;
}
