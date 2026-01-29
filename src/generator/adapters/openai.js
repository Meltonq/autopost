import axios from "axios";

export class OpenAIAdapter {
  constructor({ apiKey, baseUrl, model, temperature, topP, maxTokens }) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl || "https://api.openai.com/v1/chat/completions";
    this.model = model || "gpt-4o-mini";
    this.temperature = temperature ?? 0.8;
    this.topP = topP ?? 0.9;
    this.maxTokens = maxTokens ?? 600;
  }

  async generate({ system, user, timeoutMs }) {
    const res = await axios.post(
      this.baseUrl,
      {
        model: this.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: this.temperature,
        top_p: this.topP,
        max_tokens: this.maxTokens,
      },
      {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        timeout: timeoutMs ?? 60000,
      }
    );

    return String(res.data?.choices?.[0]?.message?.content || "").trim();
  }
}
