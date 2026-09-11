import { getPublicMembers } from "@/lib/members-live";
import MembersDirectory from "./MembersDirectory";

// Read the directory from Supabase on every request rather than from the
// build-time snapshot, so a /profile edit is public without a redeploy. Same
// pattern as /events and /education/*.
export const dynamic = "force-dynamic";

export default async function MembersPage() {
  const members = await getPublicMembers();
  return <MembersDirectory members={members} />;
}
