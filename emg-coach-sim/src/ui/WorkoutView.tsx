import { useCallback, useState } from 'react';
import { EXERCISES, exerciseById } from '../domain/exercises';
import { MUSCLE_IDS, MUSCLE_INDEX, muscleLabel, muscleShort, type MuscleId } from '../domain/muscles';
import type { BodyProfile } from '../domain/profile';
import { WebSerialEmgSource, webSerialSupported } from '../emg/WebSerialEmgSource';
import type { WorkoutEngine } from '../engine/WorkoutEngine';
import { normalize } from '../engine/slices';
import type { PhoneLink } from '../phone/PhoneLink';
import { BodyCanvas } from '../three/BodyCanvas';
import { EmgScope } from './EmgScope';
import { fmtTime, HeatLegend, MiniHeat, MuscleBars, Range, useEngine, usePhone } from './common';

type ViewMode = 'live' | 'set' | 'workout';
type Facing = { side: 'front' | 'back'; n: number };

export function WorkoutView({ engine, link, profile, onEditBody, onPair }: {
  engine: WorkoutEngine;
  link: PhoneLink;
  profile: BodyProfile;
  onEditBody: () => void;
  onPair: () => void;
}) {
  const s = useEngine(engine);
  const phone = usePhone(link);
  const [mode, setMode] = useState<ViewMode>('live');
  const [selected, setSelected] = useState<MuscleId | null>(null);
  const [serialErr, setSerialErr] = useState<string | null>(null);
  const [facing, setFacing] = useState<Facing>({ side: 'front', n: 0 });
  const ex = EXERCISES[s.exerciseIndex];

  const getValues = useCallback(() => {
    if (mode === 'live') return engine.live;
    const snap = engine.getSnapshot();
    return normalize(mode === 'set' ? snap.setLoad : snap.workoutLoad, 1);
  }, [engine, mode]);
  const getPose = useCallback(() => engine.pose, [engine]);

  const flagged = Object.fromEntries(s.alerts.map((a) => [a.muscle, a.level])) as Partial<Record<MuscleId, 'elevated' | 'high'>>;
  const sel = selected ? MUSCLE_INDEX[selected] : -1;
  const totalReps = s.slices.reduce((a, x) => a + x.reps, 0) + s.reps;

  const connectSerial = async () => {
    setSerialErr(null);
    try {
      await engine.useSource(new WebSerialEmgSource());
    } catch (e) {
      setSerialErr(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="workout">
      <aside className="rail left">
        <div className="rail-section">
          <div className="eyebrow">Exercise</div>
          <div className="ex-list">
            {EXERCISES.map((e, i) => (
              <button key={e.id} className={`ex ${i === s.exerciseIndex ? 'on' : ''}`} onClick={() => engine.selectExercise(i)}>
                <span className="ex-name">{e.name}</span>
                <span className="ex-muscles">
                  {MUSCLE_IDS.filter((m) => (e.profile[m] ?? 0) >= 0.6).map((m) => muscleShort(m)).join(' · ')}
                </span>
              </button>
            ))}
          </div>
        </div>
        <div className="rail-section">
          <div className="row-between">
            <span className="eyebrow">Load</span>
            <span className="mono">{Math.round(s.intensity * 100)}%</span>
          </div>
          <Range label="Load" value={s.intensity} min={0.3} max={1.1} step={0.05} onChange={(v) => engine.setIntensity(v)} />
        </div>

        <div className="rail-section">
          <div className="eyebrow">Set plan · shared with G2</div>
          <div className="goal-grid">
            <label>Sets<input aria-label="Target sets" type="number" min="1" max="20" value={s.targetSets} onChange={(e) => engine.setGoals(Number(e.target.value), s.targetReps, s.restTargetS)} /></label>
            <label>Reps<input aria-label="Target reps" type="number" min="1" max="100" value={s.targetReps} onChange={(e) => engine.setGoals(s.targetSets, Number(e.target.value), s.restTargetS)} /></label>
            <label>Rest s<input aria-label="Rest seconds" type="number" min="0" max="600" value={s.restTargetS} onChange={(e) => engine.setGoals(s.targetSets, s.targetReps, Number(e.target.value))} /></label>
          </div>
        </div>

        <div className="rail-section devices">
          <div className="eyebrow">Inputs</div>
          <button className={`device ${phone.phones ? 'on' : ''}`} onClick={onPair}>
            <span className={`dot ${phone.phones ? 'ok' : ''}`} />
            <span className="device-name">{phone.phones ? phone.device ?? 'Phone' : 'Phone remote'}</span>
            <span className="device-meta faint">{phone.phones ? 'connected' : `pair · ${phone.code}`}</span>
          </button>
          <div className={`device ${s.gamepadName ? 'on' : ''}`}>
            <span className={`dot ${s.gamepadName ? 'ok' : ''}`} />
            <span className="device-name">{s.gamepadName ? s.gamepadName.replace(/\(.*\)/, '').slice(0, 26) : 'Gamepad'}</span>
            <span className="device-meta faint">{s.gamepadName ? 'connected' : 'press any button'}</span>
          </div>
          <div className="device on">
            <span className={`dot ${s.sourceKind === 'webserial' ? 'ok' : 'warn'}`} />
            <span className="device-name">{s.sourceKind === 'simulated' ? 'Simulated EMG' : 'Arduino EMG'}</span>
            {s.sourceKind === 'simulated' ? (
              <button className="link device-meta" disabled={!webSerialSupported()} onClick={connectSerial}>Use Arduino</button>
            ) : (
              <button className="link device-meta" onClick={() => void engine.useSimulated()}>Use sim</button>
            )}
          </div>
          {serialErr && <div className="err">{serialErr}</div>}
        </div>

        <div className="keys faint">
          <span><kbd>Space</kbd> lift</span>
          <span><kbd>Enter</kbd> set</span>
          <span><kbd>←</kbd><kbd>→</kbd> exercise</span>
          <span><kbd>A</kbd> auto</span>
          <span><kbd>F</kbd> finish</span>
        </div>
        <button className="link" onClick={onEditBody}>Edit body model</button>
      </aside>

      <section className="stage stage-surface">
        <BodyCanvas profile={profile} getValues={getValues} getPose={getPose} selected={selected} onSelect={setSelected} dumbbells smoothing={mode === 'live' ? 0.25 : 0.1} valueLabel={mode === 'live' ? 'activation' : 'of top load'} facing={facing} hint={false} />

        <div className="hud-title">
          <div className="eyebrow">{ex.equipment}</div>
          <h2 className="serif">{ex.name}</h2>
          <div className="muted">{ex.cue}</div>
        </div>

        <div className={`hud-set ${s.inSet ? 'live' : ''}`}>
          {s.inSet ? (
            <>
              <div className="hud-set-top">
                <span className="rec" /> Set {s.exerciseSetNo}{s.exerciseSetNo <= s.targetSets ? `/${s.targetSets}` : ' · extra'}
                {s.autoRep && <span className="tag">auto</span>}
                <span className="mono faint">{fmtTime(s.setDuration)}</span>
              </div>
              <div className="hud-reps">
                <span className="mono">{String(s.reps).padStart(2, '0')}</span>
                <span className="faint">/{s.targetReps} reps · {Math.max(0, s.targetReps - s.reps)} left</span>
              </div>
            </>
          ) : (
            <>
              <div className="hud-set-top faint">{s.exerciseSetNo >= s.targetSets ? `${s.exerciseSetNo}/${s.targetSets} sets recorded` : `Set ${s.exerciseSetNo + 1}/${s.targetSets}`} · {s.restRemainingS > 0 ? `rest ${fmtTime(s.restRemainingS)}` : 'ready'}</div>
              <div className="hud-ready">
                Hold <kbd>Space</kbd>, pull <kbd>RT</kbd>{phone.phones ? <> or tap <b>Rep</b> on your phone</> : null}
              </div>
            </>
          )}
        </div>

        {s.alerts.length > 0 && (
          <div className="alerts">
            {s.alerts.slice(0, 2).map((a) => (
              <button key={a.id} className={`alert ${a.level}`} onClick={() => engine.dismissAlert(a.id)}>
                <span className="alert-title"><i className={`dot ${a.level}`} />{a.title}</span>
                <span className="alert-msg">{a.message}</span>
              </button>
            ))}
          </div>
        )}

        <div className="effort" aria-label="effort">
          <div className="effort-fill" style={{ height: `${Math.min(1, s.effort) * 100}%` }} />
        </div>

        <div className="stage-foot">
          <div className="seg small">
            {(['live', 'set', 'workout'] as const).map((m) => (
              <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>
                {m === 'live' ? 'Live' : m === 'set' ? 'This set' : 'Session'}
              </button>
            ))}
          </div>
          <div className="seg small">
            <button className={facing.side === 'front' ? 'on' : ''} onClick={() => setFacing({ side: 'front', n: facing.n + 1 })}>Front</button>
            <button className={facing.side === 'back' ? 'on' : ''} onClick={() => setFacing({ side: 'back', n: facing.n + 1 })}>Back</button>
          </div>
          <HeatLegend left="rest" right={mode === 'live' ? 'max effort' : 'most worked'} />
        </div>

        <div className="slices-strip">
          {s.slices.length === 0 ? (
            <span className="empty faint">Finished sets land here as slices — each one is overlaid on your session map.</span>
          ) : (
            s.slices.map((sl) => (
              <div key={sl.id} className="slice-chip">
                <div className="slice-chip-top">
                  <span className="mono faint">{String(sl.index).padStart(2, '0')}</span>
                  <span>{exerciseById(sl.exerciseId).name}</span>
                  <span className="mono faint">{sl.reps}×</span>
                </div>
                <MiniHeat values={sl.load} />
              </div>
            ))
          )}
        </div>
      </section>

      <aside className="rail right">
        <div className="rail-section">
          <div className="row-between">
            <span className="eyebrow">Signal</span>
            <span className="faint small">{s.sourceKind === 'simulated' ? '10 ch · 100 Hz' : 'serial'}</span>
          </div>
          <EmgScope engine={engine} />
        </div>
        <div className="rail-section grow">
          <div className="row-between">
            <span className="eyebrow">{s.inSet ? 'This set' : 'Activation'}</span>
            <span className="faint small">{s.inSet ? 'relative load' : '% max effort'}</span>
          </div>
          <MuscleBars values={s.inSet ? normalize(s.setLoad, 1) : s.live} selected={selected} onSelect={setSelected} flagged={flagged} />
          {selected && sel >= 0 && (
            <div className="muscle-info">
              <div className="row-between"><b>{muscleLabel(selected)}</b><button className="link" onClick={() => setSelected(null)}>close</button></div>
              <dl>
                <dt>Live</dt><dd className="mono">{Math.round(s.live[sel] * 100)}%</dd>
                <dt>Session load</dt><dd className="mono">{s.workoutLoad[sel].toFixed(1)} a·s</dd>
                <dt>Fatigue (sim)</dt><dd className="mono">{Math.round(s.fatigue[sel] * 100)}%</dd>
                <dt>In {ex.name.toLowerCase()}</dt><dd className="mono">{Math.round((ex.profile[selected] ?? 0) * 100)}%</dd>
              </dl>
            </div>
          )}
        </div>
        <div className="finish">
          <div className="finish-stats faint">
            <span><b className="mono">{s.slices.length}</b> sets</span>
            <span><b className="mono">{totalReps}</b> reps</span>
            <span><b className="mono">{fmtTime(s.elapsedS)}</b></span>
          </div>
          <button className="btn accent block" disabled={!s.slices.length && !s.inSet} onClick={() => engine.finish()}>
            Finish & review
          </button>
        </div>
      </aside>
    </div>
  );
}
