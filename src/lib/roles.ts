// PedQuEST authorization roles. Framework-agnostic, safe to import from both
// server routes and "use client" components.
//
// Roles live in the `user_roles` table (migration 20260903_qbank.sql), keyed by
// lowercase email because the Authentik bridge mints the Supabase user lazily —
// a role can be granted before that user_id exists.
//
// `teacher` (migration 20260915_teacher_role_test_users_annotation_targets.sql)
// sits between member and editor: a teacher sees every learner's marks on a
// lab recording, the class-results page and the answer key, but cannot edit,
// review or publish question-bank items or recordings.

export type Role = "member" | "teacher" | "editor" | "admin";

export const ROLES: Role[] = ["member", "teacher", "editor", "admin"];

/** Higher number = more privilege. Used for "at least this role" checks. */
const RANK: Record<Role, number> = { member: 0, teacher: 1, editor: 2, admin: 3 };

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
  teacher: "Teacher",
  editor: "Editor",
  admin: "Admin",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  member: "Can sign in and use the question bank, Case of the Day and the EEG Library.",
  teacher: "A member who can also see every learner's marks on a recording, the class results and the answer key.",
  editor: "Everything a teacher can do, plus reviewing, editing and publishing question-bank items and recordings.",
  admin: "Everything an editor can do, plus managing roles, deleting items and switching into test accounts.",
};

/**
 * A row in `user_roles` as the admin console and the switch-user feature see
 * it. `isTest` marks a synthetic account: excluded from every aggregate
 * statistic, and the only kind of account an admin may switch into.
 */
export interface RoleRow {
  email: string;
  role: Role;
  userId: string | null;
  isTest: boolean;
  displayName: string | null;
}
