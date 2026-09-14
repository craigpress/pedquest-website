// Who may see a lab recording. Isomorphic: the API routes enforce it, the
// pages use it to decide what to offer.
//
//   admin   every recording
//   editor  published ones, everything submitted for review, their own, and
//           the authorless AI recordings (bank exports) — those belong to
//           every editor, otherwise nobody but an admin could submit them
//   member  published ones only
//
// `status` (the worker's pipeline state) is deliberately not consulted here:
// a draft that is still exporting is the author's to watch.
import { hasRole, type Role } from "@/lib/roles";
import type { LabReviewStatus } from "./types";

export interface RecordingViewer {
  userId: string;
  role: Role;
}

export interface RecordingVisibility {
  reviewStatus: LabReviewStatus | string;
  authorId: string | null;
}

export function canSeeRecording(viewer: RecordingViewer, job: RecordingVisibility): boolean {
  if (viewer.role === "admin") return true;
  if (job.reviewStatus === "published") return true;
  if (hasRole(viewer.role, "editor")) {
    return job.reviewStatus === "pending_review" || job.authorId === null || job.authorId === viewer.userId;
  }
  return false;
}

/** The author, or an admin. AI recordings (no author) belong to every editor. */
export function canEditRecording(viewer: RecordingViewer, job: RecordingVisibility): boolean {
  if (viewer.role === "admin") return true;
  if (!hasRole(viewer.role, "editor")) return false;
  return job.authorId === null || job.authorId === viewer.userId;
}

/** Any editor who is not the author. */
export function canReviewRecording(viewer: RecordingViewer, job: RecordingVisibility): boolean {
  if (!hasRole(viewer.role, "editor")) return false;
  return job.authorId === null || job.authorId !== viewer.userId;
}
