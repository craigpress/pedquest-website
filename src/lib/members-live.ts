import type { Member } from "@/data/member-types";
import { members as snapshotMembers } from "@/data/members.generated";
import { getSupabase } from "@/lib/supabase";
import type { MemberRow } from "@/lib/members-server";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Live member directory reads for the public pages.
 *
 * /members and /members/[id] render per request (force-dynamic), so a profile
 * edit is public immediately without a redeploy. src/data/members.generated.ts
 * is still produced at build time and is used only when Supabase cannot be
 * reached at all — an empty result from a successful query means the directory
 * really is empty and is returned as such.
 *
 * Reads go through the anon key, so the public RLS policy on `members` decides
 * what is visible. The projection below is explicit: private/auth columns are
 * never selected, and the snapshot fallback is filtered to the same fields.
 */

/** Public columns only — `auth_email` and anything auth-related stay out. */
const PUBLIC_COLUMNS =
  "id,name,title,role,institution,department,country,city,lat,lng,bio,photo_url," +
  "orcid_id,interests,email,website_url,is_leadership,leadership_role,sort_order";

type PublicRow = Omit<MemberRow, "auth_email" | "status" | "updated_at">;

function rowToPublicMember(r: PublicRow): Member {
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
    websiteUrl: r.website_url ?? undefined,
    isLeadership: r.is_leadership === true,
    leadershipRole: (r.leadership_role ?? undefined) as Member["leadershipRole"],
    sortOrder: r.sort_order ?? 999,
  };
}

/** The generated module still carries authEmail; the public pages must not. */
function toPublicSnapshot(m: Member): Member {
  const { authEmail: _authEmail, ...rest } = m;
  void _authEmail;
  return rest;
}

/** Active members, sorted the way the directory renders them. The snapshot is
 *  used only when Supabase is unconfigured or the query itself failed. */
export async function getPublicMembers(
  client: SupabaseClient | null = getSupabase()
): Promise<Member[]> {
  if (!client) return snapshotMembers.map(toPublicSnapshot);

  const { data, error } = await client
    .from("members")
    .select(PUBLIC_COLUMNS)
    .eq("status", "active")
    .order("sort_order", { ascending: true });

  if (error || !data) return snapshotMembers.map(toPublicSnapshot);
  return (data as unknown as PublicRow[]).map(rowToPublicMember);
}

/** One active member by id, or null when the table says there is no such row. */
export async function getPublicMember(
  id: string,
  client: SupabaseClient | null = getSupabase()
): Promise<Member | null> {
  if (!client) {
    const m = snapshotMembers.find((s) => s.id === id);
    return m ? toPublicSnapshot(m) : null;
  }

  const { data, error } = await client
    .from("members")
    .select(PUBLIC_COLUMNS)
    .eq("id", id)
    .eq("status", "active")
    .maybeSingle();

  if (error) {
    const m = snapshotMembers.find((s) => s.id === id);
    return m ? toPublicSnapshot(m) : null;
  }
  if (!data) return null;
  return rowToPublicMember(data as unknown as PublicRow);
}
