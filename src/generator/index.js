import { OpenAIAdapter } from "./adapters/openai.js";
import { GenApiAdapter } from "./adapters/genapi.js";

export function createGenerator(config) {
  const provider = String(config.provider || "").toLowerCase();

  if (provider === "genapi") {
    return new GenApiAdapter({
      apiKey: config.genApiKey,
      endpoint: config.genApiEndpoint,
      model: config.genApiModel,
      temperature: config.temperature,
      topP: config.topP,
      maxTokens: config.maxTokens,
    });
  }

  if (provider === "openai") {
    return new OpenAIAdapter({
      apiKey: config.openAiKey,
      baseUrl: config.openAiBaseUrl,
      model: config.openAiModel,
      temperature: config.temperature,
      topP: config.topP,
      maxTokens: config.maxTokens,
    });
  }

  if (config.genApiKey) {
    return new GenApiAdapter({
      apiKey: config.genApiKey,
      endpoint: config.genApiEndpoint,
      model: config.genApiModel,
      temperature: config.temperature,
      topP: config.topP,
      maxTokens: config.maxTokens,
    });
  }

  if (config.openAiKey) {
    return new OpenAIAdapter({
      apiKey: config.openAiKey,
      baseUrl: config.openAiBaseUrl,
      model: config.openAiModel,
      temperature: config.temperature,
      topP: config.topP,
      maxTokens: config.maxTokens,
    });
  }

  throw new Error("No LLM provider configured. Set LLM_PROVIDER + API key.");
}
