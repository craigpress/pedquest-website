// The Member shape. Kept separate from members.ts so the generated module
// (members.generated.ts) can import the type without a circular import.

export interface Member {
  id: string;
  name: string;
  title: string;
  role?: string;
  institution: string;
  department?: string;
  country: string;
  city: string;
  lat: number;
  lng: number;
  bio: string;
  photoUrl?: string;
  orcidId?: string;
  interests: string[];
  email?: string;
  authEmail?: string;
  websiteUrl?: string;
  isLeadership: boolean;
  leadershipRole?: "co_director" | "scientific_committee" | "senior_advisor" | "education_lead";
  sortOrder: number;
}
