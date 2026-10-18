import { ChatOpenAI } from '@langchain/openai';

/** OpenRouter chat model from .env (or the shell). Exits with a clear message if the keys are missing. */
export function openRouterModel(temperature: number): { model: ChatOpenAI; name: string; apiKey: string } {
  try {
    process.loadEnvFile('.env');
  } catch {
    // env may come from the shell
  }
  const { OPENROUTER_API_KEY: apiKey, LLM_MODEL: name } = process.env;
  if (!apiKey || !name) {
    console.error('Set OPENROUTER_API_KEY and LLM_MODEL in .env (see .env.example).');
    process.exit(1);
  }
  const model = new ChatOpenAI({
    model: name,
    apiKey,
    temperature,
    configuration: { baseURL: 'https://openrouter.ai/api/v1' },
  });
  return { model, name, apiKey };
}
