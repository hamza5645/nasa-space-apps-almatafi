// The site's only Worker code. Pages and files are served straight from out/ without it:
// wrangler.jsonc sends just /api/* here. POST /api/wel3a answers one question for Wel3a, the
// flame guide (components/wel3a/), with Workers AI. This code keeps nothing about visitors (only
// the day's count of answers) and never logs a question's text; Cloudflare's own request logs
// (`observability` in wrangler.jsonc) note that a request was made, not what it said.

import { DAILY_ANSWERS, LIMITS, answerText, messages, parseChat } from "../lib/wel3a-chat.ts";

// The bindings in wrangler.jsonc, as far as this file uses them.
type Env = {
  ASSETS: { fetch(request: Request): Promise<Response> };
  AI: { run(model: string, input: Record<string, unknown>): Promise<unknown> };
  WEL3A_LIMIT: { limit(options: { key: string }): Promise<{ success: boolean }> };
  WEL3A_BUDGET: { getByName(name: string): { fetch(url: string): Promise<Response> } };
};

type Spent = { day: string; answers: number };
type BudgetState = { storage: { get(key: string): Promise<Spent | undefined>; put(key: string, value: Spent): Promise<void> } };

/** The day's answer budget: one Durable Object for the whole site (named "site"), so the AI
 *  spend has a ceiling whatever visitors or scripts do. It stores the day and one number. Each
 *  request to it takes one answer: 204, or 429 once the day's are used up.
 *  A plain class with a fetch handler, not an RPC class, so that this file imports nothing from
 *  the Workers runtime and its tests run in Node. */
export class AnswerBudget {
  state: BudgetState;
  constructor(state: BudgetState) { this.state = state; }

  async fetch(): Promise<Response> {
    const day = new Date().toISOString().slice(0, 10);
    const spent = await this.state.storage.get("spent");
    const answers = spent?.day === day ? spent.answers : 0;
    if (answers >= DAILY_ANSWERS) return new Response(null, { status: 429 });
    await this.state.storage.put("spent", { day, answers: answers + 1 });
    return new Response(null, { status: 204 });
  }
}

// About 12 neurons per answer, so the free 10,000 a day cover roughly 800 answers.
const MODEL = "@cf/google/gemma-4-26b-a4b-it";

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });
}

/** The body as text, or null when it is larger than `max` bytes. */
async function readCapped(request: Request, max: number): Promise<string | null> {
  if (Number(request.headers.get("content-length") ?? 0) > max) return null;
  if (!request.body) return "";
  const reader = request.body.getReader(), decoder = new TextDecoder();
  let text = "", size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    size += value.byteLength;
    if (size > max) { await reader.cancel(); return null; }
    text += decoder.decode(value, { stream: true });
  }
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/api/wel3a") return env.ASSETS.fetch(request);
    if (request.method !== "POST") return json(405, { error: "Use POST." }, { allow: "POST" });
    // Only this site's own pages may ask (browsers send Origin with every POST). A script can
    // fake the header; the rate limit below is what bounds that.
    if (request.headers.get("origin") !== url.origin) return json(403, { error: "Wel3a only answers on this site." });

    const visitor = request.headers.get("cf-connecting-ip") ?? "unknown";
    if (!(await env.WEL3A_LIMIT.limit({ key: visitor })).success) {
      return json(429, { error: "That's a lot of questions. Give me a minute." });
    }

    const text = await readCapped(request, LIMITS.body);
    if (text === null) return json(413, { error: "That message is too long." });
    let raw: unknown;
    try { raw = JSON.parse(text); } catch { return json(400, { error: "Send JSON." }); }
    const chat = parseChat(raw);
    if (typeof chat === "string") return json(400, { error: chat });

    try {
      if (!(await env.WEL3A_BUDGET.getByName("site").fetch("https://budget/take")).ok) {
        return json(429, { error: "I've answered all the questions I can for today. My tips still work, and I'm back tomorrow." });
      }
      const out = await env.AI.run(MODEL, {
        messages: messages(chat), max_tokens: 320, temperature: 0.3,
        chat_template_kwargs: { enable_thinking: false },
      });
      const answer = answerText(out);
      if (answer) return json(200, { answer });
      console.error(JSON.stringify({ event: "wel3a_empty_answer" }));
    } catch (e) {
      console.error(JSON.stringify({ event: "wel3a_error", message: e instanceof Error ? e.message : String(e) }));
    }
    return json(502, { error: "I can't answer right now." });
  },
};

export default worker;
