// Public entry point for publication data.
//
// `publications` is GENERATED from the Supabase `publications` table at build
// time (scripts/generate-publications.ts, wired to `prebuild`). The PubMed
// scanner (/api/scan-publications) and /admin write that table; the scanner
// also fires a Vercel deploy hook when it finds new papers, so a deploy is what
// makes a paper visible. Do not add papers here. The type and category list
// below are hand-maintained.

export interface Publication {
  id: string;
  pmid?: string;
  pmcid?: string;
  doi?: string;
  title: string;
  authors: string[];
  memberAuthorIds: string[];
  journal: string;
  year: number;
  month?: number;
  abstract?: string;
  pubType: "article" | "conference_abstract" | "review" | "case_report";
  conferenceName?: string;
  categories: string[];
  keywords: string[];
  isMemberPaper: boolean;
  patientPopulation?: string;
}

export { publications } from "./publications.generated";

export const publicationCategories = [
  "Autoimmune",
  "Biomarkers",
  "Brain Injury",
  "COVID-19",
  "Cardiac Arrest",
  "Cerebrovascular",
  "Clinical Trial",
  "Disorders of Consciousness",
  "ECMO/ECLS",
  "EEG",
  "Editorial",
  "Education",
  "Epilepsy",
  "Event-Related Potentials",
  "Global Health",
  "ICU",
  "Machine Learning",
  "NORSE/FIRES",
  "Neonatal",
  "Neurocritical Care",
  "Neurodevelopment",
  "Neuroimaging",
  "Neuromonitoring",
  "Outcomes",
  "Pharmacology",
  "Reliability",
  "Review",
  "Seizures",
  "Sleep",
  "Status Epilepticus",
  "Stroke",
  "Survey",
  "TBI",
  "qEEG",
];
