export * from "./types";
export * from "./pricing";
export { AnthropicProvider, mapAnthropicError } from "./anthropic";
export { MockProvider } from "./mock";

import { AnthropicProvider } from "./anthropic";
import { MockProvider } from "./mock";
import type { AIProvider, ProviderName } from "./types";

export function createProvider(name: ProviderName, apiKey: string | undefined): AIProvider {
  return name === "mock" ? new MockProvider() : new AnthropicProvider(apiKey);
}
