import type { WorkoutEngine } from '../engine/WorkoutEngine';
import { EXERCISES } from '../domain/exercises';
import { muscleLabel, type MuscleId } from '../domain/muscles';
import { newSessionCode, wsUrl, type HostState, type PhoneMsg, type ServerMsg } from './protocol';

export interface PhoneLinkStatus {
  code: string;
  online: boolean; // desktop <-> relay socket
  phones: number;
  device: string | null;
}

/**
 * Desktop side of the phone companion: joins the relay as host, applies phone commands to the
 * engine (same path as keyboard / gamepad input) and streams a compact state snapshot back.
 */
export class PhoneLink {
  readonly code: string;
  status: PhoneLinkStatus;
  private ws: WebSocket | null = null;
  private engine: WorkoutEngine;
  private listeners = new Set<() => void>();
  private timer = 0;
  private retry = 0;
  private stopped = false;
  screen: HostState['screen'] = 'onboarding';

  constructor(engine: WorkoutEngine) {
    this.engine = engine;
    const saved = sessionStorage.getItem('emgcoach.session');
    this.code = saved ?? newSessionCode();
    sessionStorage.setItem('emgcoach.session', this.code);
    this.status = { code: this.code, online: false, phones: 0, device: null };
  }

  start() {
    this.stopped = false;
    this.connect();
    this.timer = window.setInterval(() => this.broadcast(), 100);
  }

  stop() {
    this.stopped = true;
    window.clearInterval(this.timer);
    this.ws?.close();
  }

  subscribe = (cb: () => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };
  getStatus = () => this.status;

  private set(patch: Partial<PhoneLinkStatus>) {
    this.status = { ...this.status, ...patch };
    for (const l of this.listeners) l();
  }

  private connect() {
    const ws = new WebSocket(wsUrl(this.code, 'host'));
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.set({ online: true });
    };
    ws.onclose = () => {
      this.set({ online: false, phones: 0 });
      if (this.stopped) return;
      const delay = Math.min(8000, 500 * 2 ** this.retry++);
      window.setTimeout(() => this.connect(), delay);
    };
    ws.onmessage = (ev) => {
      let msg: PhoneMsg | ServerMsg;
      try {
        msg = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      this.handle(msg);
    };
  }

  private handle(msg: PhoneMsg | ServerMsg) {
    const e = this.engine;
    switch (msg.type) {
      case 'presence':
        this.set({ phones: msg.phones, device: msg.phones ? this.status.device : null });
        break;
      case 'hello':
        this.set({ device: msg.device.slice(0, 60) });
        break;
      case 'rep':
        if (this.screen === 'workout') e.remoteRep();
        break;
      case 'effort':
        if (this.screen === 'workout') e.remoteEffort(msg.value);
        break;
      case 'endSet':
        e.endSet();
        break;
      case 'selectExercise':
        e.selectExercise(msg.index);
        break;
      case 'intensity':
        e.setIntensity(msg.value);
        break;
    }
  }

  private broadcast() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || this.status.phones === 0) return;
    const s = this.engine.getSnapshot();
    const state: HostState = {
      type: 'state',
      exerciseIndex: s.exerciseIndex,
      inSet: s.inSet,
      reps: s.reps,
      setNo: s.slices.length + (s.inSet ? 1 : 0),
      exerciseSetNo: s.exerciseSetNo,
      completedExerciseSets: s.slices.filter((slice) => slice.exerciseId === EXERCISES[s.exerciseIndex].id).length,
      targetSets: s.targetSets,
      targetReps: s.targetReps,
      restTargetS: s.restTargetS,
      restRemainingS: s.restRemainingS,
      targetMuscles: Object.entries(EXERCISES[s.exerciseIndex].profile)
        .filter(([, weight]) => (weight ?? 0) >= 0.15)
        .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
        .slice(0, 3)
        .map(([id]) => muscleLabel(id as MuscleId)),
      recentSets: s.setRecords.slice(-3).map((record) => ({
        exerciseId: record.exerciseId,
        exerciseSetNo: record.exerciseSetNo,
        reps: record.reps,
        durationS: record.durationS,
        endedAt: record.endedAt,
      })),
      totalReps: s.slices.reduce((a, x) => a + x.reps, 0) + s.reps,
      intensity: s.intensity,
      effort: +this.engine.effort.toFixed(3),
      live: this.engine.live.map((v) => +Math.min(1, v).toFixed(3)),
      alerts: s.alerts.slice(0, 2).map((a) => ({ level: a.level, title: a.title })),
      coachLine: s.coachLine,
      coachSource: s.coachSource,
      screen: this.screen,
    };
    this.ws.send(JSON.stringify(state));
  }
}
