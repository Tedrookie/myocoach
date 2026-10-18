import { useEffect, useMemo, useRef, useState } from 'react';
import { coachStatus, generateCoachReport, type CoachStatus } from '../coach/llm';
import type { CoachReport } from '../coach/rules';
import { exerciseById } from '../domain/exercises';
import { MUSCLE_IDS, MUSCLE_INDEX, muscleLabel, type MuscleId } from '../domain/muscles';
import type { BodyProfile } from '../domain/profile';
import { clearHistory, loadHistory, seedDemoHistory, type SessionRecord } from '../engine/history';
import { evaluateRisk } from '../engine/risk';
import { normalize, sumVectors } from '../engine/slices';
import type { WorkoutEngine, WorkoutResult } from '../engine/WorkoutEngine';
import { BodyCanvas } from '../three/BodyCanvas';
import { heatCss } from '../three/heat';
import { fmtTime, HeatLegend, MiniHeat, MuscleBars } from './common';

type Facing = { side: 'front' | 'back'; n: number };
const FRONT_VISIBLE: MuscleId[] = ['pecs', 'delt_front', 'delt_side', 'biceps', 'forearms', 'traps'];
const BACK_VISIBLE: MuscleId[] = ['delt_rear', 'lats', 'rhomboids', 'triceps', 'traps', 'delt_side'];

export function SummaryView({ engine, result, profile, onNewWorkout, onEditBody }: {
  engine: WorkoutEngine;
  result: WorkoutResult;
  profile: BodyProfile;
  onNewWorkout: () => void;
  onEditBody: () => void;
}) {
  const { slices, session } = result;
  const [historyBefore, setHistoryBefore] = useState(result.historyBefore);
  const [enabled, setEnabled] = useState<Set<string>>(() => new Set(slices.map((s) => s.id)));
  const [selected, setSelected] = useState<MuscleId | null>(null);
  const [status, setStatus] = useState<CoachStatus | null>(null);
  const [report, setReport] = useState<(CoachReport & { error?: string }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState<SessionRecord[]>(() => loadHistory());
  const [spin, setSpin] = useState(false);
  const [facing, setFacing] = useState<Facing>({ side: 'front', n: 0 });

  const flags = useMemo(() => evaluateRisk(slices, historyBefore, Date.parse(session.date)), [slices, historyBefore, session.date]);
  const flaggedMap = Object.fromEntries(flags.map((f) => [f.muscle, f.level])) as Partial<Record<MuscleId, 'elevated' | 'high'>>;
  const active = slices.filter((s) => enabled.has(s.id));
  const cumulative = useMemo(() => sumVectors(active.map((s) => s.load)), [active]);
  const norm = useMemo(() => normalize(cumulative, 1), [cumulative]);
  const normRef = useRef(norm);
  normRef.current = norm;
  const visible = facing.side === 'front' ? FRONT_VISIBLE : BACK_VISIBLE;
  const labels = MUSCLE_IDS.map((m, i) => ({ m, v: norm[i] }))
    .filter((x) => x.v > 0.05 && visible.includes(x.m))
    .sort((a, b) => b.v - a.v)
    .slice(0, 3)
    .map(({ m, v }) => ({ muscle: m, text: `${muscleLabel(m)} · ${Math.round(v * 100)}%` }));

  const totalReps = slices.reduce((a, s) => a + s.reps, 0);
  const tut = slices.reduce((a, s) => a + s.durationS, 0);

  const runCoach = async (useLlm: boolean, st: CoachStatus) => {
    setLoading(true);
    const r = await generateCoachReport({ profile, slices, flags, history: historyBefore }, useLlm);
    setReport(r);
    setLoading(false);
    engine.setCoachLine(r.headline, r.source === 'llm' ? r.model ?? st.model ?? 'LLM' : 'rule-based');
  };

  useEffect(() => {
    void coachStatus().then((st) => {
      setStatus(st);
      void runCoach(st.llm, st);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flags]);

  const toggle = (id: string) =>
    setEnabled((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const seed = () => {
    setHistoryBefore(seedDemoHistory().filter((x) => x.id !== session.id));
    setHistory(loadHistory());
  };

  const exportSets = () => {
    const payload = { schema: 'myocoach.workout.v1', session, sets: engine.getSnapshot().setRecords };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `myocoach-${session.id}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const sel = selected ? MUSCLE_INDEX[selected] : -1;
  const sourceLabel = loading
    ? status?.llm ? `${status.model} · thinking` : 'thinking'
    : report?.source === 'llm'
      ? report.model ?? status?.model ?? 'LLM'
      : status?.llm
        ? `rule-based · fallback (${status.model} failed)`
        : 'rule-based · offline';

  return (
    <div className="summary">
      <section className="sum-hero stage-surface">
        <BodyCanvas profile={profile} getValues={() => normRef.current} selected={selected} onSelect={setSelected} smoothing={0.12} valueLabel="of top load" autoRotate={spin && !selected} facing={facing} labels={spin ? [] : labels} hint={false} />
        <div className="hud-title">
          <div className="eyebrow">Session map</div>
          <h2 className="serif">Where the work went</h2>
          <div className="muted">{active.length === slices.length ? `All ${slices.length} sets overlaid` : `${active.length} of ${slices.length} sets overlaid`}</div>
        </div>
        <div className="stage-foot">
          <div className="seg small">
            <button className={!spin && facing.side === 'front' ? 'on' : ''} onClick={() => { setSpin(false); setFacing({ side: 'front', n: facing.n + 1 }); }}>Front</button>
            <button className={!spin && facing.side === 'back' ? 'on' : ''} onClick={() => { setSpin(false); setFacing({ side: 'back', n: facing.n + 1 }); }}>Back</button>
            <button className={spin ? 'on' : ''} onClick={() => setSpin(true)}>Spin</button>
          </div>
          <HeatLegend left="untouched" right="most worked" />
        </div>
      </section>

      <section className="sum-side">
        <div className="sum-top">
          <div className="eyebrow">Review · {new Date(session.date).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</div>
          <div className="sum-actions">
            <button className="btn" onClick={exportSets}>Export set data</button>
            <button className="btn" onClick={onEditBody}>Body model</button>
            <button className="btn accent" onClick={onNewWorkout}>New session</button>
          </div>
        </div>

        <div className="coach-hero">
          <span className={`tag ${report?.source === 'llm' ? 'accent' : ''}`}>
            <span className={`dot ${report?.source === 'llm' ? 'ok' : ''}`} /> Coach · {sourceLabel}
          </span>
          {loading || !report ? (
            <div className="coach-loading">
              <div className="skeleton" style={{ height: 30, width: '92%' }} />
              <div className="skeleton" style={{ height: 30, width: '64%' }} />
              <p className="faint">{status?.llm ? `${status.model} is reading your session…` : 'Reading your session…'}</p>
            </div>
          ) : (
            <h1 className="serif coach-headline">{report.headline}</h1>
          )}
          <div className="statline">
            <span><b className="mono">{slices.length}</b> sets</span>
            <span><b className="mono">{totalReps}</b> reps</span>
            <span><b className="mono">{fmtTime(tut)}</b> under tension</span>
            <span><b className="mono">{flags.length}</b> strain {flags.length === 1 ? 'flag' : 'flags'}</span>
          </div>
          {report?.error && <div className="note warn-note">{status?.model ?? 'LLM'} call failed — showing the rule-based coach instead. <span className="faint">{report.error.slice(0, 140)}</span></div>}
        </div>

        <div className="section">
          <div className="section-head"><h4>Strain</h4><span className="faint small">time above 60% · holds above 70% · repeat load within 48 h</span></div>
          {flags.length === 0 ? (
            <p className="quiet">No sustained high-load patterns this session. Normal recovery applies.</p>
          ) : (
            flags.map((f) => (
              <button key={f.muscle} className={`risk ${f.level}`} onClick={() => setSelected(f.muscle)}>
                <div className="risk-head">
                  <b>{muscleLabel(f.muscle)}</b>
                  <span className={`tag ${f.level}`}>{f.level === 'high' ? 'High risk' : 'Elevated risk'}</span>
                </div>
                <div className="risk-why faint">{f.reasons.join(' · ')}</div>
                <div className="risk-sugg">{f.suggestion}</div>
              </button>
            ))
          )}
          <p className="disclaimer faint">Training guidance only — not a medical diagnosis.</p>
        </div>

        {report && !loading && (
          <div className="section">
            <div className="section-head"><h4>Coach notes</h4></div>
            <div className="two-col">
              <div>
                <div className="col-title">Overloaded</div>
                {report.overloaded.length ? report.overloaded.map((o) => (
                  <div key={o.muscle} className="note-item"><i style={{ background: heatCss(0.85) }} /><div><b>{muscleLabel(o.muscle)}</b><span>{o.note}</span></div></div>
                )) : <p className="quiet">Nothing overloaded.</p>}
              </div>
              <div>
                <div className="col-title">Under-trained</div>
                {report.underTrained.length ? report.underTrained.map((o) => (
                  <div key={o.muscle} className="note-item"><i style={{ background: heatCss(0.18) }} /><div><b>{muscleLabel(o.muscle)}</b><span>{o.note}</span></div></div>
                )) : <p className="quiet">Good coverage.</p>}
              </div>
            </div>
            <div className="col-title">Next session</div>
            <ol className="plan">
              {report.plan.map((p, i) => (
                <li key={p.exercise + i}>
                  <span className="mono faint">{String(i + 1).padStart(2, '0')}</span>
                  <div><b>{p.exercise}</b><span className="faint">{p.why}</span></div>
                  <span className="mono plan-dose">{p.sets} × {p.reps}</span>
                  <span className="faint plan-int">{p.intensity}</span>
                </li>
              ))}
            </ol>
            {report.insights.length > 0 && (
              <ul className="insights">{report.insights.map((t) => <li key={t}>{t}</li>)}</ul>
            )}
            <div className="col-title">Recovery</div>
            <ul className="insights">{report.restAdvice.map((t) => <li key={t}>{t}</li>)}</ul>
          </div>
        )}

        <div className="section">
          <div className="section-head">
            <h4>Slices</h4>
            <span>
              <button className="link" onClick={() => setEnabled(new Set(slices.map((s) => s.id)))}>all</button>{' '}
              <button className="link" onClick={() => setEnabled(new Set())}>none</button>
            </span>
          </div>
          <div className="slice-list">
            {slices.map((s) => (
              <label key={s.id} className={`slice-row ${enabled.has(s.id) ? 'on' : ''}`}>
                <input type="checkbox" checked={enabled.has(s.id)} onChange={() => toggle(s.id)} />
                <span className="mono faint">{String(s.index).padStart(2, '0')}</span>
                <span className="sr-name">{exerciseById(s.exerciseId).name}</span>
                <span className="mono faint">{s.reps}× · {s.durationS.toFixed(0)}s</span>
                <MiniHeat values={s.load} />
              </label>
            ))}
          </div>
        </div>

        <div className="section">
          <div className="section-head"><h4>Muscle load</h4><span className="faint small">activation-seconds</span></div>
          <MuscleBars values={cumulative} scaleMax={Math.max(...cumulative, 1)} unit="s" selected={selected} onSelect={setSelected} flagged={flaggedMap} long />
          {selected && sel >= 0 && (
            <div className="muscle-info">
              <div className="row-between"><b>{muscleLabel(selected)} by set</b><button className="link" onClick={() => setSelected(null)}>close</button></div>
              {active.map((s) => (
                <div key={s.id} className="contrib">
                  <span>{exerciseById(s.exerciseId).name}</span>
                  <span className="bar-track"><span className="bar-fill" style={{ width: `${(s.load[sel] / Math.max(1e-6, cumulative[sel])) * 100}%`, background: heatCss(Math.max(0.25, s.peak[sel])) }} /></span>
                  <span className="mono">{s.load[sel].toFixed(1)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="section">
          <div className="section-head">
            <h4>History</h4>
            <span>
              <button className="link" onClick={seed} title="Adds a heavy push day yesterday and a pull day 4 days ago">seed demo history</button>{' '}
              <button className="link" onClick={() => { clearHistory(); setHistory([]); setHistoryBefore([]); }}>clear</button>
            </span>
          </div>
          {history.length === 0 && <p className="quiet">No sessions stored on this device yet.</p>}
          {history.slice(-6).reverse().map((h) => (
            <div key={h.id} className="hist-row">
              <span>{new Date(h.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}{h.id === session.id ? ' · today' : ''}{h.demo ? ' · demo' : ''}</span>
              <span className="faint">{h.exercises.map((e) => exerciseById(e).name).join(', ')}</span>
              <MiniHeat values={h.load} />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
