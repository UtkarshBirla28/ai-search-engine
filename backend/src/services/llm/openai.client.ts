import env from '../../config/env.js';
import { HttpError, withRetry } from '../../utils/retry.js';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatCompletionResponse {
  choices: { message: { content: string } }[];
}

/** True when an OpenAI-compatible chat model is configured. */
export const isLlmEnabled = (): boolean => env.llm.provider === 'openai' && Boolean(env.llm.apiKey);

/**
 * Call OpenAI Chat Completions and return the assistant text. Thin wrapper over
 * `fetch` — no SDK dependency. Throws on non-2xx so callers can fall back.
 */
export const chat = async (messages: ChatMessage[]): Promise<string> => {
  if (!isLlmEnabled()) throw new Error('LLM is not configured (set OPENAI_API_KEY).');

  return withRetry(
    async () => {
      const res = await fetch(`${env.llm.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.llm.apiKey}`,
        },
        body: JSON.stringify({
          model: env.llm.model,
          messages,
          temperature: env.llm.temperature,
        }),
        signal: AbortSignal.timeout(45_000),
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new HttpError(`OpenAI chat failed (${res.status}): ${detail.slice(0, 300)}`, res.status);
      }

      const body = (await res.json()) as ChatCompletionResponse;
      return body.choices[0]?.message?.content?.trim() ?? '';
    },
    { label: 'openai.chat', attempts: 3 }
  );
};

export default { chat, isLlmEnabled };
