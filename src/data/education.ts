export interface EducationResource {
  id: string;
  title: string;
  description: string;
  type: "project" | "curriculum" | "module" | "tool" | "link";
  status: "planned" | "in_progress" | "active" | "archived";
  audience: string[];
  topics: string[];
  url?: string;
  leadership: string;
  sortOrder: number;
}

export const educationResources: EducationResource[] = [
  {
    id: "edu-1",
    title: "Standardized qEEG Education Curriculum",
    description: "A comprehensive, standardized curriculum for quantitative EEG education across consortium centers. Designed to provide consistent, high-quality training for all levels of clinical staff involved in EEG monitoring and interpretation.",
    type: "curriculum",
    status: "in_progress",
    audience: ["trainees", "neurology", "technicians", "intensivists"],
    topics: ["qEEG", "Education", "Standardization"],
    leadership: "Laura Caligiuri, MD & Anuj Jayakar, MD",
    sortOrder: 1,
  },
  {
    id: "edu-2",
    title: "Case-Based qEEG Training Modules",
    description: "Interactive case-based training modules featuring real-world pediatric EEG scenarios. Cases cover a range of clinical presentations including seizures, status epilepticus, cardiac arrest, and NORSE/FIRES.",
    type: "module",
    status: "in_progress",
    audience: ["trainees", "neurology"],
    topics: ["qEEG", "Case Studies", "Clinical Training"],
    leadership: "Laura Caligiuri, MD & Anuj Jayakar, MD",
    sortOrder: 2,
  },
  {
    id: "edu-3",
    title: "Bedside Decision-Support Teaching",
    description: "Decision-support modules designed for bedside use in the pediatric ICU. Helps intensivists and nursing staff interpret qEEG trends and make informed clinical decisions about neuromonitoring.",
    type: "module",
    status: "planned",
    audience: ["intensivists", "technicians"],
    topics: ["qEEG", "Decision Support", "Bedside Care"],
    leadership: "PedQuEST Education Team",
    sortOrder: 3,
  },
  {
    id: "edu-4",
    title: "Pennsieve Data Platform",
    description: "Cloud-based structured analytics platform for secure EEG waveform data sharing aligned with clinical data. Built in collaboration with the Wagenaar Lab at the University of Pennsylvania.",
    type: "tool",
    status: "active",
    audience: ["trainees", "neurology", "technicians", "intensivists"],
    topics: ["Data Platform", "EEG Data", "Research Infrastructure"],
    url: "https://pennsieve.io",
    leadership: "Joost Wagenaar, PhD",
    sortOrder: 4,
  },
];
