import type {
  ExerciseSessionResponse,
  PresetSessionResponse,
} from '@workspace/shared';
import type { WorkoutPreset } from '../types/workoutPresets';
import type {
  WorkoutPlanAssignment,
  WorkoutPlanTemplate,
} from '../types/workoutPlans';

export interface RecentWorkout {
  session: PresetSessionResponse;
  sets: number;
}

function setCount(session: PresetSessionResponse): number {
  return session.exercises.reduce((n, e) => n + e.sets.length, 0);
}

/** The latest strength workouts (grouped sessions), newest first. */
export function recentWorkouts(
  sessions: ExerciseSessionResponse[],
  limit: number
): RecentWorkout[] {
  return sessions
    .filter((s): s is PresetSessionResponse => s.type === 'preset')
    .slice(0, limit)
    .map((session) => ({ session, sets: setCount(session) }));
}

/** Local YYYY-MM-DD of the Monday starting `today`'s week. */
export function weekStart(today: Date): string {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Workouts, sets and minutes since Monday, as Hevy's weekly summary. */
export function weekSummary(
  sessions: ExerciseSessionResponse[],
  today: Date
): { workouts: number; sets: number; minutes: number } {
  const from = weekStart(today);
  let workouts = 0;
  let sets = 0;
  let minutes = 0;
  for (const s of sessions) {
    if (s.type !== 'preset' || !s.entry_date || s.entry_date < from) continue;
    workouts += 1;
    sets += setCount(s);
    minutes += s.total_duration_minutes;
  }
  return { workouts, sets, minutes: Math.round(minutes) };
}

/** "Bench Press, Row, Squat +2" for a routine card. */
export function presetExerciseLine(preset: WorkoutPreset, shown = 3): string {
  const names = preset.exercises.map((e) => e.exercise_name);
  const head = names.slice(0, shown).join(', ');
  return names.length > shown ? `${head} +${names.length - shown}` : head;
}

export interface NextPlanSession {
  plan: WorkoutPlanTemplate;
  assignment: WorkoutPlanAssignment;
  preset: WorkoutPreset;
  /** "Torso B – Schulter-/Rücken-Fokus" */
  name: string;
  /** 1-based session in the plan's sequence, with the total. */
  position: { current: number; total: number } | null;
}

/**
 * The session an active sequential plan is on, with the routine behind it -
 * the plan in Sparky decides what is next, not the weekday.
 */
export function nextPlanSession(
  plans: readonly WorkoutPlanTemplate[],
  presets: readonly WorkoutPreset[]
): NextPlanSession | null {
  for (const plan of plans) {
    if (plan.schedule_type !== 'sequential') continue;
    const assignment = plan.next_assignment;
    if (!assignment?.workout_preset_id) continue;
    const preset = presets.find(
      (p) => String(p.id) === String(assignment.workout_preset_id)
    );
    if (!preset) continue;
    return {
      plan,
      assignment,
      preset,
      name:
        assignment.workout_preset_name ||
        assignment.session_name ||
        preset.name,
      position: plan.sequence_position
        ? {
            current: plan.sequence_position.current,
            total: plan.sequence_position.total,
          }
        : null,
    };
  }
  return null;
}

/** The short routine name for a sentence: "Torso B" of "Torso B – …". */
export function shortRoutineName(name: string): string {
  return name.split(/\s[–-]\s/)[0]!.trim();
}

/** Only suggest a plan review after repeated, comparable long sessions. */
export function longRoutineSuggestion(
  sessions: readonly ExerciseSessionResponse[],
  presetId: number | string,
  thresholdMinutes = 75
): { averageMinutes: number; count: number } | null {
  const matches = sessions
    .filter(
      (s): s is PresetSessionResponse =>
        s.type === 'preset' &&
        String(s.workout_preset_id) === String(presetId) &&
        Number.isFinite(s.total_duration_minutes) &&
        s.total_duration_minutes > 0
    )
    .slice(0, 3);
  if (
    matches.length < 2 ||
    matches.some((s) => s.total_duration_minutes < thresholdMinutes)
  ) {
    return null;
  }
  return {
    averageMinutes: Math.round(
      matches.reduce((sum, s) => sum + s.total_duration_minutes, 0) /
        matches.length
    ),
    count: matches.length,
  };
}
