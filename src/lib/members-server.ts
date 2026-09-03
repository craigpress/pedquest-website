import type { Member } from "@/data/member-types";

/**
 * Row <-> Member mapping for the Supabase `members` table.
 *
 * The table is the source of truth; src/data/members.generated.ts is produced
 * from it at build time. Keep the column list here in step with
 * scripts/generate-members.ts, which renders the same fields.
 */

export type MemberStatus = "active" | "archived" | "review";

export type MemberRow = {
  id: string;
  name: string;
  title: string | null;
  role: string | null;
  institution: string | null;
  department: string | null;
  country: string | null;
  city: string | null;
  lat: number | null;
  lng: number | null;
  bio: string | null;
  photo_url: string | null;
  orcid_id: string | null;
  interests: string[] | null;
  email: string | null;
  auth_email: string | null;
  website_url: string | null;
  is_leadership: boolean | null;
  leadership_role: string | null;
  sort_order: number | null;
  status: MemberStatus;
  updated_at?: string | null;
};

export type AdminMember = Member & { status: MemberStatus; updatedAt?: string | null };

export function rowToMember(r: MemberRow): AdminMember {
  return {
    id: r.id,
    name: r.name,
    title: r.title ?? "",
    role: r.role ?? undefined,
    institution: r.institution ?? "",
    department: r.department ?? undefined,
    country: r.country ?? "USA",
    city: r.city ?? "",
    lat: r.lat ?? 0,
    lng: r.lng ?? 0,
    bio: r.bio ?? "",
    photoUrl: r.photo_url ?? undefined,
    orcidId: r.orcid_id ?? undefined,
    interests: r.interests ?? [],
    email: r.email ?? undefined,
    authEmail: r.auth_email ?? undefined,
    websiteUrl: r.website_url ?? undefined,
    isLeadership: r.is_leadership === true,
    leadershipRole: (r.leadership_role ?? undefined) as Member["leadershipRole"],
    sortOrder: r.sort_order ?? 999,
    status: r.status,
    updatedAt: r.updated_at ?? null,
  };
}

const str = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

/** Slug used as the primary key, matching the ids already in the table. */
export function memberIdFromName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

const LEADERSHIP_ROLES = ["co_director", "scientific_committee", "senior_advisor", "education_lead"];

/** Build a row from untrusted admin input. Returns an error string instead of
 *  throwing so the route can answer 400 with something useful. */
export function memberToRow(
  input: Record<string, unknown>
): { row: Partial<MemberRow>; error?: undefined } | { row?: undefined; error: string } {
  const name = str(input.name, 200);
  if (!name) return { error: "Name is required." };

  const id = str(input.id, 100) ?? memberIdFromName(name);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    return { error: `Invalid member id "${id}" - use lowercase letters, digits and hyphens.` };
  }

  const status = typeof input.status === "string" ? input.status : "active";
  if (!["active", "archived", "review"].includes(status)) {
    return { error: `Invalid status "${status}".` };
  }

  const leadershipRole = str(input.leadershipRole, 50);
  if (leadershipRole && !LEADERSHIP_ROLES.includes(leadershipRole)) {
    return { error: `Invalid leadership role "${leadershipRole}".` };
  }

  const interests = Array.isArray(input.interests)
    ? input.interests.filter((i): i is string => typeof i === "string" && i.trim() !== "").map((i) => i.trim().slice(0, 120)).slice(0, 30)
    : [];

  return {
    row: {
      id,
      name,
      title: str(input.title, 100),
      role: str(input.role, 200),
      institution: str(input.institution, 300),
      department: str(input.department, 200),
      country: str(input.country, 100) ?? "USA",
      city: str(input.city, 150),
      lat: num(input.lat),
      lng: num(input.lng),
      bio: str(input.bio, 5000),
      photo_url: str(input.photoUrl, 1000),
      orcid_id: str(input.orcidId, 50),
      interests,
      email: str(input.email, 254),
      auth_email: str(input.authEmail, 254),
      website_url: str(input.websiteUrl, 1000),
      is_leadership: input.isLeadership === true,
      leadership_role: leadershipRole,
      sort_order: num(input.sortOrder) ?? 999,
      status: status as MemberStatus,
    },
  };
}
