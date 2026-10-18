import {
  CreateStartUpPageContainer,
  OsEventTypeList,
  RebuildPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
} from '@evenrealities/even_hub_sdk';
import { exerciseById, EXERCISES } from '../domain/exercises';
import { wsUrl, type HostState, type ServerMsg } from '../phone/protocol';
import './style.css';

type Pairing = { server: string; code: string };
const PAIR_KEY = 'myocoach.g2.pair.v1';
const form = document.querySelector<HTMLFormElement>('#pair')!;
const serverInput = document.querySelector<HTMLInputElement>('#server')!;
const codeInput = document.querySelector<HTMLInputElement>('#code')!;
const status = document.querySelector<HTMLElement>('#status')!;
const preview = document.querySelector<HTMLElement>('#preview')!;

let pair: Pairing | null = null;
let socket: WebSocket | null = null;
let retryTimer = 0;
let retryCount = 0;
let hostOnline = false;
let state: HostState | null = null;
let bridge: Awaited<ReturnType<typeof waitForEvenAppBridge>> | null = null;
let shown = '';
let queued = '';
let sending = false;

function time(seconds: number): string {
  const n = Math.max(0, Math.ceil(seconds));
  return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
}

function displayText(): string {
  if (!pair) return 'MYOCOACH\n\nPair on your phone to see workout sets.';
  if (!hostOnline || !state) return 'MYOCOACH\n\nWaiting for the workout computer...';
  if (state.screen === 'onboarding') return 'MYOCOACH\n\nStart a workout on your computer.';
  if (state.screen === 'summary') {
    return `MYOCOACH · COMPLETE\n\n${state.setNo} sets · ${state.totalReps} reps\n\nReview your workout on the computer.`;
  }

  const exercise = EXERCISES[state.exerciseIndex]?.name ?? EXERCISES[0].name;
  const muscles = state.targetMuscles.join(' · ');
  if (state.inSet) {
    const left = Math.max(0, state.targetReps - state.reps);
    const setLabel = state.exerciseSetNo > state.targetSets ? `SET ${state.exerciseSetNo} (EXTRA)` : `SET ${state.exerciseSetNo}/${state.targetSets}`;
    return `MYOCOACH · ACTIVE\n${exercise}\n\n${setLabel}   ${state.reps}/${state.targetReps} REPS\n${left} reps remaining\n\nTarget: ${muscles}`;
  }

  const last = state.recentSets.at(-1);
  const lastLine = last ? `Saved #${last.exerciseSetNo}: ${exerciseById(last.exerciseId).name} · ${last.reps} reps` : 'No sets recorded yet';
  const goalMet = state.completedExerciseSets >= state.targetSets;
  if (state.restRemainingS > 0) {
    return `MYOCOACH · REST\n${exercise}\n\nREST ${time(state.restRemainingS)}\n${goalMet ? 'Set goal met' : `Next set ${state.completedExerciseSets + 1}/${state.targetSets}`}\n\n${lastLine}`;
  }
  if (goalMet) return `MYOCOACH · GOAL MET\n${exercise}\n\n${state.completedExerciseSets}/${state.targetSets} sets recorded\nChoose another exercise or continue.\n\n${lastLine}`;
  return `MYOCOACH · READY\n${exercise}\n\nSet ${state.completedExerciseSets + 1}/${state.targetSets}\nTarget: ${muscles}\n\n${lastLine}`;
}

async function flushDisplay() {
  if (sending || !bridge) return;
  sending = true;
  try {
    while (queued && bridge) {
      const next = queued;
      queued = '';
      await bridge.textContainerUpgrade(new TextContainerUpgrade({
        containerID: 1,
        containerName: 'workout',
        content: next,
      }));
    }
  } finally {
    sending = false;
  }
}

function render() {
  const text = displayText();
  if (text === shown) return;
  shown = text;
  preview.textContent = text;
  queued = text;
  void flushDisplay();
}

function connect() {
  if (!pair) return;
  window.clearTimeout(retryTimer);
  socket?.close();
  const ws = new WebSocket(wsUrl(pair.code, 'phone', pair.server));
  socket = ws;
  status.textContent = `Connecting to ${pair.server}...`;
  ws.onopen = () => {
    retryCount = 0;
    status.textContent = 'Connected to the relay. Waiting for the workout.';
    ws.send(JSON.stringify({ type: 'hello', device: 'Even G2' }));
  };
  ws.onmessage = (event) => {
    let msg: HostState | ServerMsg;
    try { msg = JSON.parse(event.data as string); } catch { return; }
    if (msg.type === 'hostStatus') {
      hostOnline = msg.online;
      if (!msg.online) state = null;
    } else if (msg.type === 'state') {
      hostOnline = true;
      state = msg;
      status.textContent = 'Workout linked. The glasses show your current set.';
    }
    render();
  };
  ws.onclose = () => {
    if (socket !== ws) return;
    hostOnline = false;
    state = null;
    status.textContent = 'Connection lost. Reconnecting...';
    render();
    retryTimer = window.setTimeout(connect, Math.min(8000, 500 * 2 ** retryCount++));
  };
  ws.onerror = () => { status.textContent = 'Could not reach the workout server. Check Wi-Fi and the server URL.'; };
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  try {
    const server = new URL(serverInput.value.trim()).origin;
    const code = codeInput.value.trim().toUpperCase();
    if (!/^[A-Z0-9]{4,8}$/.test(code)) throw new Error('Enter the 4–8 character session code.');
    wsUrl(code, 'phone', server);
    pair = { server, code };
    localStorage.setItem(PAIR_KEY, JSON.stringify(pair));
    hostOnline = false;
    state = null;
    render();
    connect();
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : 'Check the server URL and session code.';
  }
});

try {
  const query = new URLSearchParams(location.search);
  const queryServer = query.get('server');
  const queryCode = query.get('s')?.toUpperCase();
  const saved = JSON.parse(localStorage.getItem(PAIR_KEY) ?? 'null') as Pairing | null;
  if (queryServer && queryCode && /^[A-Z0-9]{4,8}$/.test(queryCode)) {
    pair = { server: new URL(queryServer).origin, code: queryCode };
    localStorage.setItem(PAIR_KEY, JSON.stringify(pair));
  } else if (saved?.server && saved?.code) {
    pair = saved;
  }
  if (pair) {
    serverInput.value = pair.server;
    codeInput.value = pair.code;
    connect();
  } else {
    serverInput.value = location.origin;
  }
} catch {
  serverInput.value = location.origin;
}

render();
void waitForEvenAppBridge().then(async (readyBridge) => {
  bridge = readyBridge;
  const page = new CreateStartUpPageContainer({
    containerTotalNum: 1,
    textObject: [new TextContainerProperty({
      xPosition: 12,
      yPosition: 12,
      width: 552,
      height: 264,
      containerID: 1,
      containerName: 'workout',
      content: shown,
      isEventCapture: 1,
    })],
  });
  const result = await bridge.createStartUpPageContainer(page);
  if (result !== 0 && !(await bridge.rebuildPageContainer(new RebuildPageContainer(page)))) {
    status.textContent = `Glasses display error: ${result}. Try reopening the app on G2.`;
    bridge = null;
    return;
  }
  bridge.onEvenHubEvent((event) => {
    if (event.textEvent?.eventType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
      void bridge?.shutDownPageContainer(1);
    }
  });
  void flushDisplay();
}).catch(() => { /* Browser preview still works without an Even bridge. */ });

window.setInterval(render, 250);
