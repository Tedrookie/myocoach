# MyoCoach — EMG smart gym coach (simulation prototype)

LA Hacks prototype of an EMG-based **upper-body smart gym coach**. Everything runs in the browser.
There are no real sensors yet: a simulated Arduino streams EMG, and a gamepad or keyboard performs the reps.

**Loop:** build body model → train sets (each set = a *slice*) → live 3D muscle activation → cumulative heatmap → strain-risk warnings → AI coach plan.

## Run

```bash
npm install
npm run dev            # http://localhost:5173 (binds 0.0.0.0 via --host so a phone on the same Wi-Fi can join)
# optional LLM coach (server-side proxy, key never reaches the browser). Priority: StepFun > OpenAI > Anthropic
STEPFUN_API_KEY=... npm run dev           # StepFun step-5-preview (optional STEPFUN_MODEL, STEPFUN_BASE_URL)
OPENAI_API_KEY=sk-... npm run dev          # optional OPENAI_MODEL (default gpt-4o-mini), OPENAI_BASE_URL
ANTHROPIC_API_KEY=... npm run dev          # optional ANTHROPIC_MODEL
npm run build && npm run preview            # production build (proxy also works in preview)
```

Without a key the coach is fully rule-based and offline. With `STEPFUN_API_KEY` set, the coach panel shows `step-5-preview` as its source.
If that model id is rejected, the proxy looks up StepFun's `/models` list and retries once with the documented step-5 preview id.
If the call fails, the panel says so and shows the rule-based coach instead. Keys created on the international StepFun platform only work with `STEPFUN_BASE_URL=https://api.stepfun.ai/v1`; `api.stepfun.com` rejects them with a 401. Put keys in your shell env or an untracked `.env.local`; never commit them. The LLM proxy only exists in `vite dev` / `vite preview`.
A static host has no proxy, so the app falls back to rules there.

### Android companion (`/phone`)

The phone is a second controller and live display. It runs in the phone's browser, so there's no APK to install.

1. Run `npm run dev` (it binds to the LAN because of `--host`). The phone and the computer must be on the same Wi-Fi.
2. On the desktop, click **Connect phone** in the top bar. The popover shows a QR code and a 4-character session code.
   When the desktop is opened via `localhost`, the QR code uses the LAN address from `GET /api/session/info`.
3. Scan the QR code with the phone camera (it opens `http://<lan-ip>:5173/phone?s=CODE`). Or open `/phone` and type the code.
4. The desktop chip turns into **Phone connected** and the Inputs list shows the device. If the phone drops, it reconnects automatically and the chip changes back.

On the phone you can pick the exercise (arrows or chips), raise or lower the load (− / +), and **tap Rep** to run one scripted rep. **Hold Rep** to grind a long effort, which can trigger strain warnings. **End set** saves the set as a slice.
The phone also shows a live 2D front/back muscle map, the rep count, the top strain alert, and the coach's last headline.
Keyboard and gamepad keep working at the same time.

**Transport.** A Vite plugin (`server/sessionRelay.ts`) adds a WebSocket relay at `/ws/session?code=CODE&role=host|phone` to the same dev/preview server.
Each session code is a room with one desktop host and any number of phones. The desktop (`src/phone/PhoneLink.ts`) stays authoritative:
- the desktop broadcasts a compact `HostState` 10× per second while a phone is connected;
- phones send `rep`, `effort`, `endSet`, `selectExercise` and `intensity` messages;
- the server sends `presence` to the desktop and `hostStatus` to phones.

Message types live in `src/phone/protocol.ts`. The relay only exists in `vite dev` / `vite preview`; a static host would need its own WebSocket server.

### Even G2 display (`/g2.html`)

The **MyoCoach G2** Even Hub app is a display-only companion. During a set it shows the exercise, target muscle groups, current/target reps, and reps remaining. After a set it shows the rest countdown and the latest saved set. The computer (or existing phone remote) remains the only workout controller. The G2 app does not require an LLM key.

Each completed set is also saved immediately in browser localStorage as a structured record (`emgcoach.sets.v1`): exercise and target muscles, actual/target reps, duration, measured rest before the set, target rest, timestamps, effort setting, EMG source, and per-muscle activation load/peak. The review screen's **Export set data** button downloads the current workout as JSON. The default signal is simulated; records are labelled `simulated` until a real Web Serial EMG source is connected. Keep the computer/browser profile because these records are local to it.

To run the newest local checkout and see the browser preview:

```bash
cd ~/Desktop/myocoach-updated/emg-coach-sim
npm install --legacy-peer-deps
npm run dev -- --port 5174 --strictPort
```

Port 5173 may still be occupied by the older `myocoach-main` checkout on this laptop, so this command uses 5174 explicitly. Open `http://localhost:5174` on the computer. Click **Connect phone** to see its 4-character session code and the computer's LAN URL. Open `http://localhost:5174/g2.html` for a browser preview; enter that LAN URL and the same code. The phone and computer must be on the same Wi-Fi. A browser preview is not proof of a successful glasses connection.

For a real Even Hub Beta package, first find the computer's current LAN URL from the Connect phone dialog or `http://localhost:5174/api/session/info`. Keep the server running on port 5174. In a second terminal:

```bash
cd ~/Desktop/myocoach-updated/emg-coach-sim
npm run g2:manifest -- http://YOUR-LAN-IP:5174
npm run g2:pack
```

This produces `myocoach-g2.ehpk` containing only the G2 companion. The generated `app.json` whitelists that **exact** server origin; if the LAN IP or port changes, regenerate the manifest and package again. Neither file is committed. In the [Even Hub developer portal](https://hub.evenrealities.com/), create the **MyoCoach G2** app, create a Beta group containing your phone account email, upload the `.ehpk` under **Builds**, and push it to that group. Sign in to the Even Realities phone app with the same email; fully close/reopen it if the developer section is missing. Pair G2, then use **Me → Beta tester** to install the build. Open it and enter the same LAN URL and session code shown by the desktop. Complete a set on the computer to see the saved-set/rest display. Test a five-minute phone lock/resume and root-page double-tap exit before judging. Physical G2 testing and Beta upload still require your developer account and device; the browser build alone does not complete those steps.

For development sideloading, use the [Even Hub CLI](https://hub.evenrealities.com/docs/reference/cli) with the live URL ending `/g2.html`. The app runs in the phone WebView and sends text to the glasses; the WebSocket relay runs only while the Vite dev/preview server is up. Do not host `dist` as static files without replacing that relay. This is workout tracking, not a medical app or diagnostic tool.

### Design

Dark and calm, with one accent colour (`#ff7a45`). The cumulative heatmap is the hero of every screen.
Typography is Instrument Serif for display, Inter for UI and JetBrains Mono for numbers. Tokens live in `src/styles/base.css`.
Empty and loading states are intentional: a slices strip placeholder, and a skeleton labelled "step-5-preview is reading your session…".

### Controls

| Action | Keyboard | Gamepad (standard mapping) |
|---|---|---|
| Lift / perform rep (effort) | hold **Space** | **RT** (analog) or right/left stick up, LT = digital |
| Start / end set | **Enter** | **A** |
| Previous / next exercise | ← → or Q / E | LB / RB, D-pad ← → |
| Load (intensity) | ↑ ↓ or − / = | D-pad ↑ ↓ |
| Auto-rep (hands-free demo) | **A** | **Y** |
| Finish workout | **F** | **Start** |

A set starts automatically when you first apply effort. It ends on Enter/A, or after 6 s idle. Click any muscle on the 3D model for details.

### Demo recording
`scripts/record-demo.mjs` drives a desktop window and an emulated Pixel 7 phone side by side with Playwright and records the X display. The script:
- pairs the phone by code;
- does phone reps, an exercise change, keyboard reps and a held heavy rep that triggers a strain warning;
- finishes with the coach review.

The wait for the LLM is trimmed out of the video. Run it with `DISPLAY=:1 node scripts/record-demo.mjs out.mp4 desktop.png phone.png`, with the dev server running. It needs `ffmpeg` and Chrome.

## Architecture

```
src/
  domain/      muscles.ts (10 muscle groups = 10 EMG channels), exercises.ts (activation profiles + arm poses), profile.ts
  emg/         types.ts        EmgSource interface, EmgFrame, CSV line parser (shared wire format)
               SimulatedEmgSource.ts   mock Arduino @100 Hz: baseline, noise, bursts, fatigue drift, artifacts
               WebSerialEmgSource.ts   real Arduino over Web Serial (Chrome/Edge)
               EmgProcessor.ts         baseline removal → rectify → RMS envelope → %MVC activation
  input/       InputController.ts      Gamepad API polling + keyboard fallback
  engine/      WorkoutEngine.ts        60 Hz control loop: input → effort → neural drive → EMG → slices, live risk alerts
               slices.ts               SliceRecorder (per-set activation series + load / peak / time-above-threshold)
               risk.ts                 strain-risk rules (in-workout + multi-session)
               history.ts              localStorage session history (+ demo seed)
  coach/       rules.ts                offline rule-based coach (under/over-trained, push:pull balance, next-session plan)
               llm.ts                  calls /api/coach (vite.config.ts proxy) and falls back to rules
  three/       BodyCanvas.tsx          procedural 3D upper body (react-three-fiber); clickable heat-coloured muscles, posed arms
  ui/          Onboarding, WorkoutView (live), EmgScope (oscilloscope), SummaryView (overlay heatmap, risk, coach, history), ConnectPhone (QR)
  phone/       protocol.ts (wire types), PhoneLink.ts (desktop host client), PhoneApp.tsx + MuscleMap2D.tsx (/phone UI)
  styles/      base.css (design tokens)
server/        sessionRelay.ts         Vite plugin: WebSocket room relay for the phone companion
```

**Data flow.**
1. The `InputController` reads the trigger or Space as *effort*.
2. The `WorkoutEngine` turns effort into a per-muscle **neural drive**: exercise profile × load × effort.
3. The `SimulatedEmgSource` turns that drive into raw ADC counts. Each sample is serialised as a CSV line and parsed back with the same parser the serial adapter uses.
4. The `EmgProcessor` converts raw counts into activation (0–1 of MVC).
5. The `SliceRecorder` accumulates activation for the current set.
6. Finished slices are summed into the cumulative map, and the risk rules and coach read them.

**Strain-risk rules** (`engine/risk.ts`, tuned short so a demo can trigger them). A muscle group is flagged when any of these apply:
- more than 25 s (elevated) or 45 s (high) above 60 % activation in one workout;
- a single continuous hold above 70 % for 12 s or longer;
- 4 or more sets reaching near-max activation;
- it was heavily loaded again within 48 h, or had 3 heavy sessions in 7 days (from localStorage history). This raises the level by one.

Warnings are phrased as *risk + rest suggestion*, never as a diagnosis.

## Swapping in real EMG / Arduino

1. **Arduino sketch.** Print one line per sample at 115200 baud, about 100 Hz. Use the channel order in `src/domain/muscles.ts`.
   An envelope sensor such as MyoWare is ideal; its output is already rectified and smoothed.
   ```cpp
   const int pins[10] = {A0,A1,A2,A3,A4,A5,A6,A7,A8,A9};   // Mega; use a mux / fewer channels on Uno
   void setup(){ Serial.begin(115200); }
   void loop(){
     Serial.print(millis());
     for(int i=0;i<10;i++){ Serial.print(','); Serial.print(analogRead(pins[i])); }
     Serial.println(); delay(10);
   }
   ```
   Lines may be `millis,c0..c9` or `c0..c9`. Fewer channels: pass `channels: ['biceps','triceps',...]` to `new WebSerialEmgSource({ channels })`.
2. **In the app.** Click **Connect Arduino (Web Serial)** in the workout's left panel (Chrome/Edge). Or call `engine.useSource(new WebSerialEmgSource())`.
3. **Calibration.** With no calibration hint, `EmgProcessor` tracks the rest floor automatically and uses a running max as MVC.
   For real use, add a calibration step: 3 s rest, then 3 s max contraction per muscle. Pass the result as `calibrationHint`.
4. **Other transports** (BLE, WebSocket bridge from Python, etc.). Implement the 4-method `EmgSource` interface (`start`, `stop`, `onFrame`, `info`). Nothing else changes.

With real sensors, the gamepad only drives the avatar pose and rep counting. Muscle activation comes from the EMG itself.

## Status

- **Works:** onboarding scaling, 3D model with 10 clickable muscle groups, 9 exercises with poses, simulated 100 Hz EMG with fatigue, gamepad and keyboard input, sets as slices, live / per-set / cumulative heatmaps, slice overlay toggles, live and summary strain warnings, localStorage history with multi-session escalation, rule-based coach, StepFun / OpenAI / Anthropic LLM coach, Android companion over WebSocket.
- **Stubbed / simplified:** the Web Serial adapter is implemented but untested on hardware, with no calibration UI. Muscles are procedural ellipsoids, not anatomical meshes. Risk thresholds are demo-tuned, not validated. Left and right sides share one channel per group.
