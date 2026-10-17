import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, type BaseMessage } from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';

export type Step = { tool: string; args: Record<string, unknown> } | { say: string };

/**
 * Deterministic stand-in for an LLM: returns the next scripted step on every call, whichever agent asks.
 * Lets tests and CI drive the real swarm, tools, recorder and graph without a network.
 */
export class ScriptedChatModel extends BaseChatModel {
  private i = 0;

  constructor(private readonly steps: Step[]) {
    super({});
  }

  _llmType(): string {
    return 'scripted';
  }

  override bindTools(): this {
    return this;
  }

  async _generate(_messages: BaseMessage[]): Promise<ChatResult> {
    const step = this.steps[this.i++] ?? { say: 'Done.' };
    const message =
      'say' in step
        ? new AIMessage(step.say)
        : new AIMessage({
            content: '',
            tool_calls: [{ id: `call_${this.i}`, name: step.tool, args: step.args, type: 'tool_call' }],
          });
    return { generations: [{ message, text: typeof message.content === 'string' ? message.content : '' }] };
  }
}
