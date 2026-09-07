const MAX_PHRASE_LENGTH = 500;
const MAX_CONTEXT_LENGTH = 1200;
const MAX_TITLE_LENGTH = 300;
const MAX_AI_TEXT_LENGTH = 1200;
const MAX_AI_ITEM_LENGTH = 500;
const OPENAI_TIMEOUT_MS = 30 * 1000;

export async function requestExplanation(card, settings) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
  let response;

  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${settings.apiKey}`,
        "Content-Type": "application/json"
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: cleanText(settings.model).slice(0, 100) || "gpt-4.1-mini",
        store: false,
        max_output_tokens: 600,
        input: [
          {
            role: "system",
            content: "You explain saved words and short phrases for a curious reader. Be concise, accurate, and context-aware."
          },
          {
            role: "user",
            content: JSON.stringify({
              task: "Explain this saved word or phrase.",
              phrase: cleanText(card.selectedText).slice(0, MAX_PHRASE_LENGTH),
              surroundingContext: cleanText(card.contextText).slice(0, MAX_CONTEXT_LENGTH),
              sourceTitle: cleanText(card.sourceTitle).slice(0, MAX_TITLE_LENGTH),
              sourceHost: sourceHost(card.sourceUrl),
              responseShape: {
                summary: "One or two plain-language sentences.",
                contextMeaning: "Meaning in the provided context, if context exists.",
                examples: ["Two short example uses."],
                relatedTerms: ["Three related words, phrases, or concepts."]
              }
            })
          }
        ],
        text: {
          format: {
            type: "json_schema",
            name: "phraselet_explanation",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                summary: { type: "string" },
                contextMeaning: { type: "string" },
                examples: {
                  type: "array",
                  items: { type: "string" },
                  maxItems: 3
                },
                relatedTerms: {
                  type: "array",
                  items: { type: "string" },
                  maxItems: 5
                }
              },
              required: ["summary", "contextMeaning", "examples", "relatedTerms"]
            }
          }
        }
      })
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("OpenAI request timed out. Try again.");
    }
    throw new Error("Could not reach OpenAI. Check your connection and try again.");
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const requestId = response.headers?.get?.("x-request-id");
    const message = openAiHttpError(response.status);
    throw new Error(requestId ? `${message} Request ID: ${requestId}.` : message);
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("OpenAI returned an unreadable response. Try again.");
  }
  if (data.status === "failed") {
    throw new Error("OpenAI could not create an explanation. Try again.");
  }
  if (data.status === "incomplete") {
    throw new Error("OpenAI returned an incomplete explanation. Try again.");
  }

  const text = extractResponseText(data);
  if (!text) {
    throw new Error("OpenAI returned an empty explanation.");
  }

  try {
    return normalizeExplanation(JSON.parse(text));
  } catch {
    throw new Error("OpenAI returned an explanation in an unexpected format. Try again.");
  }
}

function extractResponseText(data) {
  if (typeof data?.output_text === "string") {
    return data.output_text;
  }

  return Array.isArray(data?.output)
    ? data.output.flatMap((item) => Array.isArray(item?.content) ? item.content : [])
      .filter((part) => part?.type === "output_text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("")
    : "";
}

function openAiHttpError(status) {
  if (status === 401 || status === 403) {
    return "OpenAI rejected the API key. Check it in Settings.";
  }
  if (status === 429) {
    return "OpenAI is rate-limiting requests. Wait a moment and try again.";
  }
  if (status >= 500) {
    return "OpenAI is temporarily unavailable. Try again later.";
  }
  return `OpenAI request failed (${status}).`;
}

function normalizeExplanation(explanation) {
  return {
    summary: cleanText(explanation.summary).slice(0, MAX_AI_TEXT_LENGTH),
    contextMeaning: cleanText(explanation.contextMeaning).slice(0, MAX_AI_TEXT_LENGTH),
    examples: Array.isArray(explanation.examples)
      ? explanation.examples
        .map((item) => cleanText(item).slice(0, MAX_AI_ITEM_LENGTH))
        .filter(Boolean)
        .slice(0, 3)
      : [],
    relatedTerms: Array.isArray(explanation.relatedTerms)
      ? explanation.relatedTerms
        .map((item) => cleanText(item).slice(0, MAX_AI_ITEM_LENGTH))
        .filter(Boolean)
        .slice(0, 5)
      : []
  };
}

function sourceHost(value) {
  try {
    const url = new URL(cleanText(value));
    return ["http:", "https:"].includes(url.protocol) ? url.hostname : "";
  } catch {
    return "";
  }
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
