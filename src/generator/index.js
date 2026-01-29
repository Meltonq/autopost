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

  throw new Error("No LLM provider configured. Set LLM_PROVIDER + GENAPI_API_KEY.");
}
