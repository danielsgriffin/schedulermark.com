// benchmarkUtils.ts

import { mkdir, access } from "node:fs/promises";
import { constants } from "node:fs";

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_REFERER =
  process.env.OPENROUTER_REFERER || "https://schedulermark.com";
const OPENROUTER_TITLE = process.env.OPENROUTER_TITLE || "SchedulerMark";

if (!OPENROUTER_API_KEY) {
  console.error("Missing OPENROUTER_API_KEY in environment.");
  process.exit(1);
}

/**
 * Ensure the solutions/, data/, and logs/ directories exist.
 */
export async function ensureDirs() {
  await mkdir("solutions", { recursive: true });
  await mkdir("data", { recursive: true });
  await mkdir("logs", { recursive: true });
}

/**
 * Simple existence check that doesn’t throw.
 */
export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Call OpenRouter chat completions and return the string content.
 */
// benchmarkUtils.ts

type OpenRouterChatResponse = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ text?: string }>;
    };
  }>;
};

type CallOptions = {
  maxTokens?: number;
};

export async function callOpenRouter(
  model: string,
  prompt: string,
  options: CallOptions = {}
): Promise<string> {
  const maxTokens = options.maxTokens ?? 4096; // sensible default

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": OPENROUTER_REFERER,
      "X-Title": OPENROUTER_TITLE,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `OpenRouter error for ${model}: ${res.status} ${res.statusText}\n${text}`
    );
  }

  const json = (await res.json()) as OpenRouterChatResponse;
  const message = json.choices?.[0]?.message;
  let content = message?.content;

  if (Array.isArray(content)) {
    content = content.map((part) => part.text ?? "").join("\n");
  }

  if (typeof content !== "string") {
    throw new Error(`Unexpected response shape for ${model}`);
  }
  return content;
}

/**
 * Parse the YES/NO + explanation shape we asked judges for.
 */
export function parseVerdict(raw: string) {
  const lines = raw.split(/\r?\n/).map((l) => l.trim());
  const idx = lines.findIndex((l) => l.length > 0);
  if (idx === -1) {
    return { verdict: "ERROR", explanation: "Empty response" };
  }

  const first = lines[idx]?.toUpperCase();
  const verdict = first === "YES" ? "YES" : first === "NO" ? "NO" : "NO";
  const explanation = lines
    .slice(idx + 1)
    .join("\n")
    .trim();

  return { verdict, explanation };
}
