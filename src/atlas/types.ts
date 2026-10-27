export interface Candidate {
  id: string;
  label: string;
  description: string;
}

export interface Source {
  label: string;
  url: string;
}

export interface ConceptNode {
  id: string;
  label: string;
  description: string;
  entityId?: string;
  evidence: "documented" | "claim" | "inferred";
  explanation: string;
  sources: Source[];
  children?: ConceptNode[];
}

export interface Category {
  id: string;
  label: string;
  description: string;
  nodes: ConceptNode[];
}

export interface Exploration {
  id: string;
  root: Candidate;
  categories: Category[];
  createdAt: string;
  warnings: string[];
  mode: "wikidata" | "example";
}
