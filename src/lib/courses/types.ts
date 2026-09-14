// Courses — isomorphic types shared by the API routes and the pages.
//
// Vocabulary follows Google Classroom / Canvas so it reads naturally to
// teachers: a COURSE has a ROSTER (students, extra instructors) and
// ASSIGNMENTS (one published lab recording each, with instructions and a due
// date); every student has one SUBMISSION state per assignment:
//
//   not_started  no marks, never opened
//   in_progress  opened the recording or has marks, not yet turned in
//   submitted    student pressed "Done with this EEG"
//   returned     teacher reviewed it and wrote feedback
//
// Grades are never stored: the class-results scoring (src/lib/lab/scoring.ts)
// is recomputed from the student's marks and the recording's answer key, so a
// student who keeps marking after "done" is re-graded the next time a teacher
// looks. The gradebook and every KPI are derived from these rows.

export type CourseStatus = "draft" | "active" | "archived";
export type CourseMemberRole = "student" | "instructor";
export type SubmissionStatus = "not_started" | "in_progress" | "submitted" | "returned";
/** how the caller relates to a course; drives what the detail route returns */
export type CourseViewerRole = "owner" | "instructor" | "student" | "admin";

export const COURSE_STATUS_LABELS: Record<CourseStatus, string> = { draft: "Draft", active: "Active", archived: "Archived" };
export const SUBMISSION_LABELS: Record<SubmissionStatus, string> = {
  not_started: "Not started", in_progress: "In progress", submitted: "Done", returned: "Returned",
};
/** one colour per state, used for chips and stacked bars */
export const SUBMISSION_COLORS: Record<SubmissionStatus, string> = {
  not_started: "#8e8e93", in_progress: "#f5a524", submitted: "#30a46c", returned: "#3e63dd",
};

export interface CourseSummary {
  id: string;
  title: string;
  description: string;
  status: CourseStatus;
  ownerId: string;
  ownerEmail: string;
  ownerName: string | null;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  studentCount: number;
  assignmentCount: number;
  myRole: CourseViewerRole;
  /** students: assignments done (submitted or returned) out of total */
  progress: { done: number; total: number } | null;
  /** teachers: submitted-or-returned cells over students × assignments, 0..1; null with no cells */
  completion: number | null;
}

export interface RosterEntry {
  email: string;
  displayName: string | null;
  userId: string | null;
  role: CourseMemberRole;
  addedAt: string;
  isTest: boolean;
}

export interface CourseAssignment {
  id: string;
  courseId: string;
  jobId: string;
  /** shown to students; defaults to the recording's title */
  title: string;
  instructions: string;
  /** scoring task id, see SEIZURE_TASK / DISCHARGE_TASK */
  taskId: string;
  dueAt: string | null;
  sortOrder: number;
  published: boolean;
  createdAt: string;
  /** from the recording */
  recordingTitle: string | null;
  durationS: number;
}

export interface SubmissionState {
  status: SubmissionStatus;
  /** the student's marks on that recording right now */
  markCount: number;
  openedAt: string | null;
  submittedAt: string | null;
  returnedAt: string | null;
  feedback: string;
  /** submitted after the due date */
  late: boolean;
  /** class-results composite 0..100 for that recording; null without an answer key or marks */
  score: number | null;
  sensitivity: number | null;
  falseAlarms: number | null;
  medianLatencyS: number | null;
}

export interface CourseKpis {
  students: number;
  assignments: number;
  /** cells = students × published assignments */
  cells: number;
  notStarted: number;
  inProgress: number;
  submitted: number;
  returned: number;
  /** (submitted + returned) / cells */
  completion: number | null;
  /** on-time fraction of the turned-in cells that had a due date */
  onTime: number | null;
  meanScore: number | null;
  meanSensitivity: number | null;
  meanFalseAlarms: number | null;
  medianLatencyS: number | null;
}

export interface AssignmentStats {
  assignmentId: string;
  notStarted: number;
  inProgress: number;
  submitted: number;
  returned: number;
  late: number;
  meanScore: number | null;
  meanSensitivity: number | null;
}

export interface StudentStats {
  email: string;
  displayName: string | null;
  userId: string | null;
  isTest: boolean;
  done: number;
  total: number;
  meanScore: number | null;
  lastActivityAt: string | null;
}

/** GET /api/courses/[id] — a teacher's (owner / instructor / admin) view */
export interface CourseDetailTeacher extends CourseSummary {
  canManage: true;
  roster: RosterEntry[];
  assignments: CourseAssignment[];
  /** assignmentId → student email → state */
  matrix: Record<string, Record<string, SubmissionState>>;
  kpis: CourseKpis;
  perAssignment: AssignmentStats[];
  perStudent: StudentStats[];
}

/** GET /api/courses/[id] — an enrolled student's view */
export interface CourseDetailStudent extends CourseSummary {
  canManage: false;
  assignments: (CourseAssignment & { my: SubmissionState })[];
}

export type CourseDetail = CourseDetailTeacher | CourseDetailStudent;

/** GET /api/courses/people — someone a teacher can enrol */
export interface CoursePerson {
  email: string;
  name: string | null;
  institution: string | null;
  hasAccount: boolean;
  isTest: boolean;
}

export function isSubmissionStatus(v: unknown): v is SubmissionStatus {
  return v === "not_started" || v === "in_progress" || v === "submitted" || v === "returned";
}

export function isDone(s: SubmissionStatus): boolean {
  return s === "submitted" || s === "returned";
}
