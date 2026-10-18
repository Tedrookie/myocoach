import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sessionRelay } from './server/sessionRelay.ts';
import { resolve } from 'node:path';

/**
 * Tiny server-side proxy so LLM keys never reach the browser. Priority:
 *   STEPFUN_API_KEY   (+ optional STEPFUN_MODEL, default step-5-preview, STEPFUN_BASE_URL)
 *   OPENAI_API_KEY    (+ optional OPENAI_MODEL, default gpt-4o-mini, OPENAI_BASE_URL)
 *   ANTHROPIC_API_KEY (+ optional ANTHROPIC_MODEL, default claude-3-5-haiku-latest)
 * With none set, /api/coach/status reports llm:false and the app stays rule-based.
 */
function coachProxy(env: Record<string, string>): Plugin {
  const stepfunKey = env.STEPFUN_API_KEY;
  const openaiKey = env.OPENAI_API_KEY;
  const anthropicKey = env.ANTHROPIC_API_KEY;
  const provider = stepfunKey ? 'stepfun' : openaiKey ? 'openai' : anthropicKey ? 'anthropic' : null;
  let model =
    provider === 'stepfun'
      ? env.STEPFUN_MODEL || 'step-5-preview'
      : provider === 'openai'
        ? env.OPENAI_MODEL || 'gpt-4o-mini'
        : env.ANTHROPIC_MODEL || 'claude-3-5-haiku-latest';
  const stepfunBase = env.STEPFUN_BASE_URL || 'https://api.stepfun.com/v1';

  const system = `You are an evidence-based strength coach inside an EMG muscle-activation app (upper body only).
You receive per-muscle activation load for a workout, strain-risk flags and recent sessions.
Reply ONLY with JSON: {"headline": string, "underTrained": [{"muscle": <muscleId>, "note": string}], "overloaded": [{"muscle": <muscleId>, "note": string}], "insights": string[], "plan": [{"exercise": <one of availableExercises>, "sets": number, "reps": string, "intensity": string, "why": string}]}.
Cover overloaded groups, under-trained groups and the next session. Keep notes short (<25 words). This is training guidance only, not medical advice: never diagnose injuries; phrase strain as risk and suggest rest or seeing a professional.`;

  async function readBody(req: IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    return Buffer.concat(chunks).toString('utf8');
  }

  async function stepfunChat(user: string) {
    return fetch(`${stepfunBase}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${stepfunKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
  }

  /** If the configured model id is rejected, look up the documented step-5 preview id from /models and retry once. */
  async function resolveStepfunModel(): Promise<string | null> {
    const r = await fetch(`${stepfunBase}/models`, { headers: { authorization: `Bearer ${stepfunKey}` } });
    if (!r.ok) return null;
    const j = (await r.json()) as { data?: { id: string }[] };
    const ids = (j.data ?? []).map((m) => m.id);
    return ids.find((id) => /^step-?5.*preview/i.test(id)) ?? ids.find((id) => /^step-?5/i.test(id)) ?? null;
  }

  async function callStepfun(user: string, allowRetry: boolean): Promise<string> {
    const r = await stepfunChat(user);
    if (!r.ok) {
      const text = await r.text();
      if (allowRetry && (r.status === 400 || r.status === 404) && /model/i.test(text)) {
        const alt = await resolveStepfunModel();
        if (alt && alt !== model) {
          console.warn(`[coach] StepFun rejected model "${model}", retrying with "${alt}"`);
          model = alt;
          return callStepfun(user, false);
        }
      }
      throw new Error(`StepFun ${r.status}: ${text.slice(0, 300)}`);
    }
    const j = (await r.json()) as { choices: { message: { content: string } }[] };
    return j.choices[0].message.content;
  }

  async function callLlm(payload: unknown): Promise<string> {
    const user = JSON.stringify(payload);
    if (provider === 'stepfun') return callStepfun(user, true);
    if (provider === 'openai') {
      const base = env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
      const r = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${openaiKey}` },
        body: JSON.stringify({
          model,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
      });
      if (!r.ok) throw new Error(`OpenAI ${r.status}: ${await r.text()}`);
      const j = (await r.json()) as { choices: { message: { content: string } }[] };
      return j.choices[0].message.content;
    }
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 1200, system, messages: [{ role: 'user', content: user }] }),
    });
    if (!r.ok) throw new Error(`Anthropic ${r.status}: ${await r.text()}`);
    const j = (await r.json()) as { content: { text: string }[] };
    return j.content[0].text;
  }

  const handler = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (req.url === '/api/coach/status') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(provider ? { llm: true, provider, model } : { llm: false }));
      return;
    }
    if (req.url === '/api/coach' && req.method === 'POST') {
      res.setHeader('content-type', 'application/json');
      if (!provider) {
        res.statusCode = 503;
        res.end(JSON.stringify({ error: 'no LLM key configured' }));
        return;
      }
      try {
        const body = JSON.parse(await readBody(req));
        const text = await callLlm(body.workout);
        const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
        res.end(JSON.stringify({ ...json, provider, model }));
      } catch (e) {
        res.statusCode = 502;
        res.end(JSON.stringify({ error: String(e) }));
      }
      return;
    }
    next();
  };

  return {
    name: 'coach-llm-proxy',
    configureServer(server) {
      server.middlewares.use((req, res, next) => void handler(req, res, next));
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => void handler(req, res, next));
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env } as Record<string, string>;
  const input: Record<string, string> = { g2: resolve(import.meta.dirname, 'g2.html') };
  if (mode !== 'g2') input.main = resolve(import.meta.dirname, 'index.html');
  return {
    plugins: [react(), coachProxy(env), sessionRelay()],
    build: {
      rollupOptions: {
        input,
      },
    },
  };
});
