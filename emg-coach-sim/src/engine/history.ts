import { MUSCLE_IDS, zeroVector, type MuscleId, type MuscleVector } from '../domain/muscles';
import type { RiskLevel } from './risk';

/** Durable, compact record of a completed set. Raw EMG samples stay in the in-memory Slice. */
export interface SetRecord {
  id: string;
  workoutId: string;
  exerciseId: string;
  setNo: number;
  exerciseSetNo: number;
  targetSets: number;
  targetReps: number;
  targetMuscles: MuscleId[];
  startedAt: string;
  endedAt: string;
  durationS: number;
  restBeforeS: number;
  restTargetS: number;
  reps: number;
  intensity: number;
  emgSource: 'simulated' | 'webserial';
  emgLoad: MuscleVector;
  emgPeak: MuscleVector;
}

export interface SessionRecord {
  id: string;
  date: string; // ISO
  durationS: number;
  sets: number;
  exercises: string[];
  load: MuscleVector;
  highTime: MuscleVector;
  flags: (RiskLevel | null)[];
  demo?: boolean;
}

const KEY = 'emgcoach.history.v1';
const SETS_KEY = 'emgcoach.sets.v1';

export function loadSetRecords(): SetRecord[] {
  try {
    const raw = localStorage.getItem(SETS_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return [];
    return list.filter((s): s is SetRecord =>
      !!s && typeof s === 'object' && typeof s.id === 'string' &&
      typeof s.exerciseId === 'string' && Number.isFinite(s.reps) &&
      Array.isArray(s.emgLoad) && s.emgLoad.length === MUSCLE_IDS.length,
    );
  } catch {
    return [];
  }
}

export function appendSetRecord(record: SetRecord): void {
  const list = [...loadSetRecords().filter((s) => s.id !== record.id), record];
  localStorage.setItem(SETS_KEY, JSON.stringify(list.slice(-500)));
}

export function loadHistory(): SessionRecord[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as SessionRecord[]) : [];
    return list.filter((s) => Array.isArray(s.load) && s.load.length === MUSCLE_IDS.length);
  } catch {
    return [];
  }
}

export function saveHistory(list: SessionRecord[]) {
  localStorage.setItem(KEY, JSON.stringify(list.slice(-60)));
}

export function appendSession(rec: SessionRecord): SessionRecord[] {
  const list = [...loadHistory().filter((s) => s.id !== rec.id), rec];
  saveHistory(list);
  return list;
}

export function clearHistory() {
  localStorage.removeItem(KEY);
}

/** Adds a heavy push session ~26h ago and a pull session 4 days ago so cross-session warnings can be demoed. */
export function seedDemoHistory(): SessionRecord[] {
  const now = Date.now();
  const mk = (hoursAgo: number, vals: Partial<Record<string, [number, number]>>, exercises: string[]): SessionRecord => {
    const load = zeroVector();
    const highTime = zeroVector();
    MUSCLE_IDS.forEach((m, i) => {
      const v = vals[m];
      if (v) {
        load[i] = v[0];
        highTime[i] = v[1];
      }
    });
    return {
      id: `demo-${hoursAgo}`,
      date: new Date(now - hoursAgo * 3600_000).toISOString(),
      durationS: 2400,
      sets: 12,
      exercises,
      load,
      highTime,
      flags: highTime.map((h) => (h >= 45 ? 'high' : h >= 25 ? 'elevated' : null)),
      demo: true,
    };
  };
  const list = [
    ...loadHistory().filter((s) => !s.demo),
    mk(98, { lats: [60, 14], rhomboids: [55, 12], biceps: [42, 18], delt_rear: [30, 6], forearms: [35, 4], traps: [28, 5] }, ['pulldown', 'row', 'curl']),
    mk(26, { pecs: [78, 52], delt_front: [61, 30], triceps: [55, 28], delt_side: [20, 3], forearms: [18, 1] }, ['bench', 'ohp', 'pushdown']),
  ].sort((a, b) => a.date.localeCompare(b.date));
  saveHistory(list);
  return list;
}
