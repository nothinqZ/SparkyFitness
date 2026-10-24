export interface AssignmentProgressionInput {
  id: string | number;
  session_index?: number | null;
  session_name?: string | null;
  sort_order?: number | null;
  day_of_week?: number | null;
  workout_preset_id?: number | null;
  exercise_id?: string | null;
}

export interface LoggedEntryProgressionInput {
  id?: string | number;
  workout_plan_assignment_id?: string | number | null;
  entry_date?: string | Date;
  created_at?: string | Date;
}

export interface SequencePosition {
  current: number;
  total: number;
  session_name?: string | null;
}

export interface SequentialProgressionResult<
  T extends AssignmentProgressionInput,
> {
  nextAssignments: T[];
  nextAssignment: T | null;
  sequencePosition: SequencePosition | null;
}

/**
 * Computes the active session and progress position for a sequential workout plan.
 * Pure function: given assignments and chronologically sorted logged entries,
 * suggests the session after the last completed one. Choosing a different
 * session in the diary deliberately moves the rotation to that point.
 */
export function computeSequentialPlanProgression<
  T extends AssignmentProgressionInput,
>(
  assignments: T[],
  loggedRows: LoggedEntryProgressionInput[]
): SequentialProgressionResult<T> {
  if (!assignments || assignments.length === 0) {
    return {
      nextAssignments: [],
      nextAssignment: null,
      sequencePosition: null,
    };
  }

  // Group distinct session indices (sorted ascending)
  const sessionIndices: number[] = Array.from(
    new Set<number>(assignments.map((a) => a.session_index ?? 1))
  ).sort((a: number, b: number) => a - b);

  if (sessionIndices.length === 0) {
    return {
      nextAssignments: [],
      nextAssignment: null,
      sequencePosition: null,
    };
  }

  const normalizeId = (id: string | number): string => String(id);
  const sessionByAssignment = new Map(
    assignments.map((a) => [normalizeId(a.id), a.session_index ?? 1])
  );
  const requiredBySession = new Map<number, Set<string>>();
  for (const a of assignments) {
    const session = a.session_index ?? 1;
    const required = requiredBySession.get(session) ?? new Set<string>();
    required.add(normalizeId(a.id));
    requiredBySession.set(session, required);
  }

  let lastCompletedSession: number | null = null;
  let currentSession: number | null = null;
  let completedAssignments = new Set<string>();
  const finishSession = () => {
    if (currentSession === null) return;
    const required = requiredBySession.get(currentSession);
    if (required && [...required].every((id) => completedAssignments.has(id))) {
      lastCompletedSession = currentSession;
    }
  };
  for (const row of loggedRows) {
    const assignmentId = row.workout_plan_assignment_id;
    if (assignmentId === null || assignmentId === undefined) continue;
    const session = sessionByAssignment.get(normalizeId(assignmentId));
    if (session === undefined) continue;
    if (session !== currentSession) {
      finishSession();
      currentSession = session;
      completedAssignments = new Set<string>();
    }
    completedAssignments.add(normalizeId(assignmentId));
  }
  finishSession();

  const lastOrder =
    lastCompletedSession === null
      ? -1
      : sessionIndices.indexOf(lastCompletedSession);
  const nextSessionOrder = (lastOrder + 1) % sessionIndices.length;
  const nextSessionIndex = sessionIndices[nextSessionOrder] ?? 1;

  const activeSessionAssignments = assignments.filter(
    (a) => (a.session_index ?? 1) === nextSessionIndex
  );

  const currentSessionName = activeSessionAssignments[0]?.session_name || null;

  return {
    nextAssignments: activeSessionAssignments,
    nextAssignment: activeSessionAssignments[0] || null,
    sequencePosition: {
      current: nextSessionOrder + 1,
      total: sessionIndices.length,
      session_name: currentSessionName,
    },
  };
}
