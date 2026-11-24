// Free proofreading for the editor. Tries Gemini, then Cloudflare's built-in AI.
// It only returns suggestions and never saves or publishes anything.
import {
  SYSTEM_PROMPT,
  cleanSuggestions,
  parseModelReply,
  replaceOnce,
  userPrompt,
  validItems,
} from "../../lib/proofread-rules.mjs";

const GEMINI_MODEL = "gemini-flash-lite-latest";
const CLOUDFLARE_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const MODEL_TIMEOUT_MS = 6000;
const TOTAL_TIME_MS = 14000;
const MIN_RECHECK_MS = 2000;
const MAX_BODY_BYTES = 32 * 1024;
const LOGIN_TIMEOUT_MS = 2000;
const MAX_LOGIN_HEADER = 8192;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", "x-robots-tag": "noindex" },
  });

// Only someone logged in to this TinaCloud project can use this endpoint.
async function isSignedIn(request, env) {
  const authorization = request.headers.get("authorization") ?? "";
  const clientId = env.NEXT_PUBLIC_TINA_CLIENT_ID;
  if (!clientId || authorization.length > MAX_LOGIN_HEADER || !/^Bearer [\w.-]+$/.test(authorization)) return false;
  try {
    const response = await fetch(`https://identity.tinajs.io/v2/apps/${encodeURIComponent(clientId)}/currentUser`, {
      headers: { authorization },
      redirect: "manual",
      signal: AbortSignal.timeout(LOGIN_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

const BUSY = new Set([429, 500, 503]);
const RETRY_PAUSE_MS = 700;

// Google is sometimes briefly overloaded, so a busy reply gets one more try.
async function askGemini(items, env, timeoutMs) {
  const started = Date.now();
  try {
    return await askGeminiOnce(items, env, timeoutMs);
  } catch (error) {
    const left = timeoutMs - (Date.now() - started) - RETRY_PAUSE_MS;
    if (!BUSY.has(error?.status) || left < MIN_RECHECK_MS) throw error;
    console.warn(`proofread: ${error.message}, trying Gemini once more`);
    await new Promise((resolve) => setTimeout(resolve, RETRY_PAUSE_MS));
    return askGeminiOnce(items, env, left);
  }
}

async function askGeminiOnce(items, env, timeoutMs) {
  if (!env.GEMINI_API_KEY) throw new Error("no Gemini key");
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts: [{ text: userPrompt(items) }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 2000, responseMimeType: "application/json" },
    }),
  });
  if (!response.ok) {
    // Google's error code and message, never the key or the edited text.
    const reply = await response.json().catch(() => ({}));
    const reason = [reply?.error?.status, reply?.error?.message].filter(Boolean).join(": ").slice(0, 200);
    throw Object.assign(new Error(`Gemini returned ${response.status}${reason ? ` (${reason})` : ""}`), { status: response.status });
  }
  const data = await response.json();
  return (data.candidates?.[0]?.content?.parts ?? []).map((part) => part.text ?? "").join("");
}

async function askCloudflare(items, env, timeoutMs) {
  if (!env.AI) throw new Error("no Workers AI binding");
  const answer = await Promise.race([
    env.AI.run(CLOUDFLARE_MODEL, {
      temperature: 0,
      max_tokens: 1500,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt(items) },
      ],
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error("Workers AI timed out")), timeoutMs)),
  ]);
  const reply = answer?.response ?? answer?.choices?.[0]?.message?.content;
  return typeof reply === "string" ? reply : JSON.stringify(reply);
}

// Models can stop after the first mistake, so check once more with those fixes applied.
async function findMistakes(ask, items, env, deadline) {
  const timeLeft = () => Math.min(MODEL_TIMEOUT_MS, deadline - Date.now());
  const first = cleanSuggestions(parseModelReply(await ask(items, env, timeLeft())), items);
  if (!first.length || timeLeft() < MIN_RECHECK_MS) return first;
  const corrected = items.map((item) => ({
    ...item,
    text: first.filter(({ id }) => id === item.id).reduce((text, fix) => replaceOnce(text, fix.original, fix.replacement), item.text),
  }));
  try {
    const second = parseModelReply(await ask(corrected, env, timeLeft()));
    return cleanSuggestions({ suggestions: [...first, ...(Array.isArray(second?.suggestions) ? second.suggestions : [])] }, items);
  } catch {
    return first;
  }
}

export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  if (request.headers.get("origin") !== url.origin || request.headers.get("x-proofread") !== "1") {
    return json({ error: "forbidden" }, 403);
  }
  if (!(await isSignedIn(request, env))) return json({ error: "forbidden" }, 403);

  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return json({ error: "too large" }, 413);
  let items;
  try {
    items = JSON.parse(raw).items;
  } catch {
    return json({ error: "bad request" }, 400);
  }
  if (!validItems(items)) return json({ error: "bad request" }, 400);

  const deadline = Date.now() + TOTAL_TIME_MS;
  for (const [name, ask] of [["Gemini", askGemini], ["Cloudflare AI", askCloudflare]]) {
    if (deadline - Date.now() < MIN_RECHECK_MS) break;
    try {
      const suggestions = await findMistakes(ask, items, env, deadline);
      console.log(`proofread: answered by ${name}`);
      return json({ checked: true, suggestions });
    } catch (error) {
      // Shown in Cloudflare's logs, so a failing model can be found. Try the next free model.
      console.warn(`proofread: ${name} failed: ${error?.name === "TimeoutError" ? "timed out" : error?.message}`);
    }
  }
  // Proofreading is a helper, so a failure never blocks the editor.
  return json({ checked: false, suggestions: [] });
}
