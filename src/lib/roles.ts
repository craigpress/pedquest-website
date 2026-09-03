// PedQuEST authorization roles. Framework-agnostic, safe to import from both
// server routes and "use client" components.
//
// Roles live in the `user_roles` table (migration 20260903_qbank.sql), keyed by
// lowercase email because the Authentik bridge mints the Supabase user lazily —
// a role can be granted before that user_id exists.

export type Role = "member" | "editor" | "admin";

export const ROLES: Role[] = ["member", "editor", "admin"];

/** Higher number = more privilege. Used for "at least this role" checks. */
const RANK: Record<Role, number> = { member: 0, editor: 1, admin: 2 };

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as string[]).includes(value);
}

/** True when `role` satisfies a requirement of at least `minimum`. */
export function hasRole(role: Role | null | undefined, minimum: Role): boolean {
  if (!role) return false;
  return RANK[role] >= RANK[minimum];
}

export const ROLE_LABELS: Record<Role, string> = {
  member: "Member",
  editor: "Editor",
  admin: "Admin",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  member: "Can sign in and use the question bank and Case of the Day.",
  editor: "Can review, edit and publish question-bank items.",
  admin: "Everything an editor can do, plus managing roles and deleting items.",
};
