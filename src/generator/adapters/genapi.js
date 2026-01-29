import axios from "axios";

export class GenApiAdapter {
  constructor({ apiKey, endpoint, model, temperature, topP, maxTokens }) {
    this.apiKey = apiKey;
    this.endpoint = endpoint || "https://api.gen-api.ru/api/v1/networks/qwen-3";
    this.model = model || "qwen-plus";
    this.temperature = temperature ?? 0.9;
    this.topP = topP ?? 0.95;
    this.maxTokens = maxTokens ?? 520;
  }

  async generate({ system, user, timeoutMs }) {
    const res = await axios.post(
      this.endpoint,
      {
        is_sync: true,
        model: this.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "text" },
        temperature: this.temperature,
        top_p: this.topP,
        max_new_tokens: this.maxTokens,
      },
      {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        timeout: timeoutMs ?? 60000,
      }
    );

    return String(res.data?.response?.[0]?.message?.content || "").trim();
  }
}
