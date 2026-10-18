/** Messages exchanged over /ws/session between the desktop host and companions. */

export interface HostState {
  type: 'state';
  exerciseIndex: number;
  inSet: boolean;
  reps: number;
  setNo: number;
  exerciseSetNo: number;
  completedExerciseSets: number;
  targetSets: number;
  targetReps: number;
  restTargetS: number;
  restRemainingS: number;
  targetMuscles: string[];
  recentSets: { exerciseId: string; exerciseSetNo: number; reps: number; durationS: number; endedAt: string }[];
  totalReps: number;
  intensity: number;
  effort: number;
  live: number[];
  alerts: { level: 'elevated' | 'high'; title: string }[];
  coachLine: string | null;
  coachSource: string | null;
  screen: 'onboarding' | 'workout' | 'summary';
}

export type PhoneMsg =
  | { type: 'hello'; device: string }
  | { type: 'rep' }
  | { type: 'effort'; value: number }
  | { type: 'endSet' }
  | { type: 'selectExercise'; index: number }
  | { type: 'intensity'; value: number };

export type ServerMsg = { type: 'presence'; phones: number } | { type: 'hostStatus'; online: boolean };

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function newSessionCode(): string {
  let s = '';
  for (let i = 0; i < 4; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

export function wsUrl(code: string, role: 'host' | 'phone', origin = location.origin): string {
  const base = new URL(origin);
  if (base.protocol !== 'http:' && base.protocol !== 'https:') throw new Error('Use an http or https MyoCoach server URL');
  const proto = base.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${base.host}/ws/session?code=${encodeURIComponent(code)}&role=${role}`;
}
