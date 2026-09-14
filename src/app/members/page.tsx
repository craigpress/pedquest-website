import { getPublicMembers } from "@/lib/members-live";
import MembersDirectory from "./MembersDirectory";

// Read the directory from Supabase rather than from the build-time snapshot,
// so a /profile edit is public without a redeploy — but cache the rendered
// page: a fresh query on every request cost ~900 ms. The page is regenerated
// at most every 5 minutes, and immediately when an admin or a member saves
// (revalidatePath in the write routes). Same pattern as /events and
// /education/question-bank.
export const revalidate = 300;

export default async function MembersPage() {
  const members = await getPublicMembers();
  return <MembersDirectory members={members} />;
}
