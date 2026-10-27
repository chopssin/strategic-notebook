import type { Exploration } from "./types";

const sep = {
  label: "Stanford Encyclopedia of Philosophy · Hannah Arendt",
  url: "https://plato.stanford.edu/entries/arendt/",
};

/** A deliberately small, editorial starting map, never presented as AI output. */
export const startingMap: Exploration = {
  id: "example-arendt-v1",
  mode: "example",
  root: {
    id: "Q60025",
    label: "Hannah Arendt",
    description: "Political thinker · 1906–1975",
  },
  createdAt: "2026-10-26T00:00:00.000Z",
  warnings: [
    "This is a curated example, not a generated or exhaustive map. Expanding a node retrieves live Wikidata records.",
  ],
  categories: [
    {
      id: "inspired-by",
      label: "Inspired by",
      description: "Intellectual influences discussed in the source.",
      nodes: [
        {
          id: "arendt-heidegger",
          entityId: "Q48301",
          label: "Martin Heidegger",
          description: "Philosophy · hermeneutics",
          evidence: "documented",
          explanation:
            "Arendt adopted a way of rereading philosophical traditions from Heidegger. Influence does not imply agreement with his politics.",
          sources: [sep],
        },
        {
          id: "arendt-benjamin",
          entityId: "Q61078",
          label: "Walter Benjamin",
          description: "Philosophy · history",
          evidence: "documented",
          explanation:
            "Benjamin’s fragmentary approach to history informed Arendt’s recovery of neglected possibilities in the past.",
          sources: [sep],
        },
      ],
    },
    {
      id: "influenced",
      label: "Influenced",
      description:
        "No downstream influence claims have been reviewed for this starting map. This is missing evidence, not evidence of no influence.",
      nodes: [],
    },
    {
      id: "responded-to",
      label: "Responded to",
      description: "Engagement with an earlier argument or body of work.",
      nodes: [
        {
          id: "arendt-kant",
          entityId: "Q9312",
          label: "Immanuel Kant",
          description: "Philosophy · judgment",
          evidence: "documented",
          explanation:
            "Arendt developed her account of political judgment through an interpretation of Kant’s aesthetics.",
          sources: [sep],
        },
      ],
    },
    {
      id: "challenged",
      label: "Challenged",
      description: "A specific disagreement, not a wholesale rejection.",
      nodes: [
        {
          id: "arendt-plato",
          entityId: "Q859",
          label: "Plato",
          description: "Philosophy · political opinion",
          evidence: "documented",
          explanation:
            "Arendt defended plural political opinion against Plato’s devaluation of opinion in politics.",
          sources: [sep],
        },
        {
          id: "arendt-hobbes",
          entityId: "Q37621",
          label: "Thomas Hobbes",
          description: "Philosophy · political opinion",
          evidence: "documented",
          explanation:
            "Her defense of deliberation and diverse opinions also opposed Hobbes’s treatment of political opinion.",
          sources: [sep],
        },
      ],
    },
    {
      id: "thematic-parallels",
      label: "Thematic parallels",
      description:
        "No similarities inferred in this edition. A shared topic or citation alone does not establish intellectual influence.",
      nodes: [],
    },
  ],
};
