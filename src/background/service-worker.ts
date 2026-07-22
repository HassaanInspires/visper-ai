// Chrome Extension Background Service Worker

// Enable opening the side panel when clicking the extension icon
if (typeof chrome !== 'undefined' && chrome.sidePanel && typeof chrome.sidePanel.setPanelBehavior === 'function') {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error: unknown) => console.error("Error setting side panel behavior:", error));
}

// Event listener for installation
chrome.runtime.onInstalled.addListener(() => {
  console.log("Visper AI Sidebar Extension installed successfully.");
});

// Reference to currently active generation request controller for cancellation
let activeAbortController: AbortController | null = null;
let currentStreamTarget = "sidebar";

// Helper for making streaming fetch requests to LLM APIs (OpenAI format)
async function runStreamFetch(
  endpoint: string,
  apiKey: string,
  modelName: string,
  prompt: string,
  history: any[],
  image?: string
) {
  const formattedHistory = history.map(h => ({
    role: h.sender === "user" ? "user" : "assistant",
    content: h.text
  }));

  let messageContent: any = prompt;
  if (image) {
    messageContent = [
      { type: "text", text: prompt },
      { type: "image_url", image_url: { url: image } }
    ];
  }

  const messages = [...formattedHistory, { role: "user", content: messageContent }];

  // Cancel any active previous request and set up a new controller
  activeAbortController?.abort();
  activeAbortController = new AbortController();

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "HTTP-Referer": "https://github.com/hassaan",
      "X-Title": "Visper AI"
    },
    body: JSON.stringify({
      model: modelName,
      messages: messages,
      max_tokens: 4096,
      stream: true
    }),
    signal: activeAbortController.signal
  });

  if (!response.ok) {
    const errorText = await response.text();
    const status = response.status;
    const err = new Error(errorText || `HTTP Error ${status}`);
    (err as any).status = status;
    throw err;
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("Response body is not readable");

  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  let streamFinished = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const cleanLine = line.trim();
      if (!cleanLine) continue;
      if (cleanLine.startsWith("data: ")) {
        const dataStr = cleanLine.slice(6);
        if (dataStr === "[DONE]") {
          chrome.runtime.sendMessage({ type: "STREAM_COMPLETE", target: currentStreamTarget }).catch(() => {});
          streamFinished = true;
          return;
        }
        try {
          const parsed = JSON.parse(dataStr);
          const text = parsed.choices?.[0]?.delta?.content || "";
          if (text) {
            chrome.runtime.sendMessage({ type: "STREAM_CHUNK", text, target: currentStreamTarget }).catch(() => {});
          }
        } catch (err) {
          // Parse error
        }
      }
    }
  }

  if (!streamFinished) {
    chrome.runtime.sendMessage({ type: "STREAM_COMPLETE", target: currentStreamTarget }).catch(() => {});
  }
}

// Helper for making streaming fetch requests specifically to Anthropic (Claude) API
async function runClaudeStreamFetch(
  apiKey: string,
  modelName: string,
  prompt: string,
  history: any[],
  image?: string
) {
  const formattedHistory = history.map(h => ({
    role: h.sender === "user" ? "user" : "assistant",
    content: h.text
  }));

  let messageContent: any = prompt;
  if (image) {
    const base64Data = image.split(",")[1] || image;
    messageContent = [
      {
        type: "image",
        source: {
          type: "base64",
          media_type: "image/png",
          data: base64Data
        }
      },
      { type: "text", text: prompt }
    ];
  }

  const messages = [...formattedHistory, { role: "user", content: messageContent }];

  // Cancel any active previous request and set up a new controller
  activeAbortController?.abort();
  activeAbortController = new AbortController();

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "dangerously-allow-browser": "true"
    },
    body: JSON.stringify({
      model: modelName,
      messages: messages,
      max_tokens: 4096,
      stream: true
    }),
    signal: activeAbortController.signal
  });

  if (!response.ok) {
    const errorText = await response.text();
    const status = response.status;
    const err = new Error(errorText || `Claude HTTP Error ${status}`);
    (err as any).status = status;
    throw err;
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("Claude response body is not readable");

  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  let streamFinished = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const cleanLine = line.trim();
      if (!cleanLine) continue;
      
      if (cleanLine.startsWith("data: ")) {
        const dataStr = cleanLine.slice(6);
        try {
          const parsed = JSON.parse(dataStr);
          if (parsed.type === "content_block_delta" && parsed.delta?.text) {
            chrome.runtime.sendMessage({ type: "STREAM_CHUNK", text: parsed.delta.text, target: currentStreamTarget }).catch(() => {});
          } else if (parsed.type === "message_stop") {
            chrome.runtime.sendMessage({ type: "STREAM_COMPLETE", target: currentStreamTarget }).catch(() => {});
            streamFinished = true;
            return;
          }
        } catch (err) {
          // Parse error
        }
      }
    }
  }

  if (!streamFinished) {
    chrome.runtime.sendMessage({ type: "STREAM_COMPLETE", target: currentStreamTarget }).catch(() => {});
  }
}

async function transcribeImageToText(image: string, keys: any): Promise<{ text: string; provider: string }> {
  // 1. Try OpenAI vision
  if (keys.openai) {
    console.log("Transcribing image via OpenAI gpt-4o-mini...");
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${keys.openai}`
        },
        body: JSON.stringify({
          model: keys.openaiModel || "gpt-4o-mini",
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: "Transcribe all visible text from this image exactly. If there is no text, reply with nothing. Do not add any introductory or explanatory remarks." },
                { type: "image_url", image_url: { url: image } }
              ]
            }
          ],
          max_tokens: 1000
        })
      });
      if (res.ok) {
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content?.trim();
        if (text) return { text, provider: "OpenAI" };
      }
    } catch (e: any) {
      console.warn("OpenAI vision transcription failed:", e.message);
    }
  }

  // 2. Try Claude vision
  if (keys.claude) {
    console.log("Transcribing image via Claude...");
    try {
      const base64Data = image.split(",")[1] || image;
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": keys.claude,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: keys.claudeModel || "claude-3-5-sonnet-20241022",
          max_tokens: 1000,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: "image/png",
                    data: base64Data
                  }
                },
                { type: "text", text: "Transcribe all visible text from this image exactly. If there is no text, reply with nothing. Do not add any introductory or explanatory remarks." }
              ]
            }
          ]
        })
      });
      if (res.ok) {
        const data = await res.json();
        const text = data.content?.[0]?.text?.trim();
        if (text) return { text, provider: "Claude" };
      }
    } catch (e: any) {
      console.warn("Claude vision transcription failed:", e.message);
    }
  }

  // 3. Try OpenRouter vision fallback
  if (keys.openrouter) {
    console.log("Transcribing image via OpenRouter flash vision...");
    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${keys.openrouter}`
        },
        body: JSON.stringify({
          model: "google/gemini-flash-1.5-8b",
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: "Transcribe all visible text from this image exactly. If there is no text, reply with nothing. Do not add any introductory or explanatory remarks." },
                { type: "image_url", image_url: { url: image } }
              ]
            }
          ],
          max_tokens: 1000
        })
      });
      if (res.ok) {
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content?.trim();
        if (text) return { text, provider: "OpenRouter (Gemini)" };
      }
    } catch (e: any) {
      console.warn("OpenRouter vision transcription failed:", e.message);
    }
  }

  throw new Error("This model is text-only and cannot process images directly. Set up an OpenAI/Claude/OpenRouter key in Settings to auto-extract text from screenshot crops.");
}

// Orchestrator that routes messages and handles fallbacks
async function handleGenerateStream(
  prompt: string,
  history: any[],
  model: string,
  keys: any,
  image?: string
) {
  try {
    // If we have an image and are routing to a text-only model, transcribe it first using available vision keys
    if (image && (model === "deepseek" || model === "groq" || model === "mistral" || model === "gemini-nano")) {
      try {
        chrome.runtime.sendMessage({
          type: "STREAM_CHUNK",
          text: "[🔍 OCR: Extracting text from screenshot crop...]\n\n",
          target: currentStreamTarget
        }).catch(() => {});

        const ocrResult = await transcribeImageToText(image, keys);
        if (ocrResult.text) {
          prompt = `[Extracted Text from Crop]:\n${ocrResult.text}\n\nUser Query: ${prompt}`;
        } else {
          prompt = `[The screenshot crop contains no recognizable text]\n\nUser Query: ${prompt}`;
        }
        chrome.runtime.sendMessage({
          type: "OCR_PROVIDER_USED",
          provider: ocrResult.provider,
          target: currentStreamTarget
        }).catch(() => {});
        image = undefined; // Clear the image content parameter so text-only models don't crash
      } catch (err: any) {
        chrome.runtime.sendMessage({
          type: "STREAM_ERROR",
          error: err.message,
          target: currentStreamTarget
        }).catch(() => {});
        return;
      }
    }

    switch (model) {
      case "groq": {
        const pool = (keys.groq || "").split(",").map((k: string) => k.trim()).filter(Boolean);
        if (pool.length === 0) throw new Error("Groq key missing.");
        
        const activeModelName = keys.groqModel || "llama-3.3-70b-specdec";
        let success = false;
        for (let i = 0; i < pool.length; i++) {
          try {
            await runStreamFetch("https://api.groq.com/openai/v1/chat/completions", pool[i], activeModelName, prompt, history, image);
            success = true;
            break;
          } catch (err: any) {
            console.warn(`Groq Key ${i} failed:`, err.message);
            if (err.status === 429 && i < pool.length - 1) continue;
            
            const orPool = (keys.openrouter || "").split(",").map((k: string) => k.trim()).filter(Boolean);
            if (orPool.length > 0) {
              const activeOrModel = keys.openrouterModel || "meta-llama/llama-3-8b-instruct:free";
              console.log("Groq rate limited. Cascading to OpenRouter fallback...");
              await runStreamFetch("https://openrouter.ai/api/v1/chat/completions", orPool[0], activeOrModel, prompt, history, image);
              success = true;
              break;
            } else {
              throw err;
            }
          }
        }
        if (!success) throw new Error("Groq streaming request failed.");
        break;
      }

      case "openrouter": {
        const pool = (keys.openrouter || "").split(`,`).map((k: string) => k.trim()).filter(Boolean);
        if (pool.length === 0) throw new Error("OpenRouter key missing.");
        
        const activeModelName = keys.openrouterModel || "meta-llama/llama-3-8b-instruct:free";
        let success = false;
        for (let i = 0; i < pool.length; i++) {
          try {
            await runStreamFetch("https://openrouter.ai/api/v1/chat/completions", pool[i], activeModelName, prompt, history, image);
            success = true;
            break;
          } catch (err: any) {
            if (err.status === 429 && i < pool.length - 1) continue;
            throw err;
          }
        }
        if (!success) throw new Error("OpenRouter streaming request failed.");
        break;
      }

      case "openai": {
        if (!keys.openai) throw new Error("OpenAI API key missing.");
        const activeModelName = keys.openaiModel || "gpt-4o-mini";
        await runStreamFetch("https://api.openai.com/v1/chat/completions", keys.openai, activeModelName, prompt, history, image);
        break;
      }

      case "deepseek": {
        if (!keys.deepseek) throw new Error("DeepSeek API key missing.");
        const activeModelName = keys.deepseekModel || "deepseek-chat";
        await runStreamFetch("https://api.deepseek.com/v1/chat/completions", keys.deepseek, activeModelName, prompt, history, image);
        break;
      }

      case "claude": {
        if (!keys.claude) throw new Error("Claude (Anthropic) API key missing.");
        const activeModelName = keys.claudeModel || "claude-3-5-sonnet-20241022";
        await runClaudeStreamFetch(keys.claude, activeModelName, prompt, history, image);
        break;
      }

      case "mistral": {
        if (!keys.mistral) throw new Error("Mistral API key missing.");
        const activeModelName = keys.mistralModel || "mistral-small-latest";
        await runStreamFetch("https://api.mistral.ai/v1/chat/completions", keys.mistral, activeModelName, prompt, history, image);
        break;
      }

      case "custom": {
        if (!keys.customUrl) throw new Error("Custom Endpoint URL is missing.");
        const url = keys.customUrl.replace(/\/$/, "") + "/chat/completions";
        const modelName = keys.customModel || "custom-model";
        await runStreamFetch(url, keys.customKey || "", modelName, prompt, history, image);
        break;
      }

      default:
        throw new Error(`Unsupported background model selector: ${model}`);
    }
  } catch (err: any) {
    console.error("Stream generation error:", err);
    chrome.runtime.sendMessage({ type: "STREAM_ERROR", error: err.message, target: currentStreamTarget }).catch(() => {});
  }
}

// Global promise to prevent duplicate offscreen document creation calls concurrently
let offscreenPromise: Promise<void> | null = null;

async function createOffscreenDocument(): Promise<void> {
  // @ts-ignore
  if (await chrome.offscreen.hasDocument?.()) {
    offscreenPromise = null; // Clear cached promise if document exists
    return;
  }

  if (offscreenPromise) {
    return offscreenPromise;
  }

  offscreenPromise = (async () => {
    // @ts-ignore
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: [chrome.offscreen.Reason.DOM_PARSER],
      justification: "Compute local text embeddings via Transformers.js WASM."
    });
  })();

  try {
    await offscreenPromise;
  } catch (err) {
    throw err;
  } finally {
    offscreenPromise = null; // Reset promise tracker after compilation task resolves
  }
}

// Fetch models list helper from standard API endpoints
async function fetchModelsFromApi(provider: string, apiKey: string, customUrl?: string): Promise<string[]> {
  let url = "";
  let headers: HeadersInit = {};

  switch (provider) {
    case "openai":
      url = "https://api.openai.com/v1/models";
      headers = { "Authorization": `Bearer ${apiKey}` };
      break;
    case "groq":
      url = "https://api.groq.com/openai/v1/models";
      headers = { "Authorization": `Bearer ${apiKey}` };
      break;
    case "openrouter":
      url = "https://openrouter.ai/api/v1/models";
      headers = { "Authorization": `Bearer ${apiKey}` };
      break;
    case "deepseek":
      url = "https://api.deepseek.com/v1/models";
      headers = { "Authorization": `Bearer ${apiKey}` };
      break;
    case "mistral":
      url = "https://api.mistral.ai/v1/models";
      headers = { "Authorization": `Bearer ${apiKey}` };
      break;
    case "custom":
      if (!customUrl) throw new Error("Custom URL is required.");
      url = customUrl.replace(/\/$/, "") + "/models";
      if (apiKey) {
        headers = { "Authorization": `Bearer ${apiKey}` };
      }
      break;
    case "claude":
      // Claude has no standard public CORS /v1/models fetch list endpoint, return typical defaults
      return ["claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022", "claude-3-opus-20240229"];
    default:
      return [];
  }

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`Failed to fetch models: HTTP ${response.status}`);
  }

  const json = await response.json();
  if (json && Array.isArray(json.data)) {
    const list = json.data.map((m: any) => m.id);
    list.sort();
    return list;
  }
  return [];
}

// Service Worker message listener
chrome.runtime.onMessage.addListener((
  message: any, 
  _sender: chrome.runtime.MessageSender, 
  sendResponse: (response?: any) => void
) => {
  console.log("Background service worker received message:", message.type);

  if (message.type === "PING") {
    sendResponse({ status: "PONG" });
    return false;
  }

  if (message.type === "QUICK_ACTION") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (tab?.id) {
        // Open the sidebar panel programmatically
        // @ts-ignore
        chrome.sidePanel.open({ windowId: tab.windowId }).then(() => {
          // Store the action in shared storage for sidebar retrieval
          chrome.storage.local.set({
            pendingQuickAction: {
              action: message.action,
              text: message.text,
              timestamp: Date.now()
            }
          });
        }).catch((err) => {
          console.error("Failed to open side panel programmatically:", err);
        });
      }
    });
    sendResponse({ success: true });
    return false;
  }

  if (message.type === "GENERATE_STREAM") {
    currentStreamTarget = "sidebar";
    handleGenerateStream(message.prompt, message.history, message.model, message.keys, message.image);
    sendResponse({ status: "STREAMING_STARTED" });
    return false;
  }

  if (message.type === "GENERATE_STREAM_INLINE") {
    currentStreamTarget = "inline-composer";
    handleGenerateStream(message.prompt, message.history, message.model, message.keys, message.image);
    sendResponse({ status: "STREAMING_STARTED" });
    return false;
  }

  if (message.type === "ABORT_STREAM") {
    if (activeAbortController) {
      activeAbortController.abort();
      activeAbortController = null;
      console.log("Service Worker: Active generation stream cancelled.");
    }
    // Also notify sidebar UI that stream has been completed/interrupted
    chrome.runtime.sendMessage({ type: "STREAM_COMPLETE", target: currentStreamTarget }).catch(() => {});
    currentStreamTarget = "sidebar"; // reset
    sendResponse({ success: true });
    return false;
  }

  if (message.type === "GET_MAIN_WORLD_YT_RESPONSE") {
    (async () => {
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tabId = tabs[0]?.id;
        if (!tabId) {
          sendResponse({ success: false, error: "No active tab found." });
          return;
        }

        const results = await chrome.scripting.executeScript({
          target: { tabId },
          world: "MAIN",
          func: () => {
            try {
              // 1. Try movie_player getPlayerResponse() API
              const moviePlayer = document.querySelector("#movie_player") as any;
              if (moviePlayer && typeof moviePlayer.getPlayerResponse === "function") {
                const playerResp = moviePlayer.getPlayerResponse();
                if (playerResp && playerResp.videoDetails) return JSON.stringify(playerResp);
              }
              // 2. Try ytd-watch-flexy element playerData
              const watchFlexy = document.querySelector("ytd-watch-flexy") as any;
              if (watchFlexy && watchFlexy.playerData && watchFlexy.playerData.videoDetails) {
                return JSON.stringify(watchFlexy.playerData);
              }
              // 3. Fallback to global window.ytInitialPlayerResponse
              // @ts-ignore
              return window.ytInitialPlayerResponse ? JSON.stringify(window.ytInitialPlayerResponse) : null;
            } catch (e) {
              return null;
            }
          }
        });

        const rawResult = results?.[0]?.result;
        const playerResponse = rawResult ? JSON.parse(rawResult) : null;
        sendResponse({ success: true, result: playerResponse });
      } catch (err: any) {
        console.error("GET_MAIN_WORLD_YT_RESPONSE script execution error:", err);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true; // keeps port active
  }

  if (message.type === "FETCH_YOUTUBE_CAPTION_BACKGROUND") {
    (async () => {
      try {
        const captionTracks = message.captionTracks || [];
        if (captionTracks.length === 0) {
          sendResponse({ success: false, error: "No caption tracks provided." });
          return;
        }

        const transcript: { text: string; start: number; duration: number }[] = [];
        const candidateTracks = [
          ...captionTracks.filter((t: any) => t.languageCode === "en" || t.languageCode === "ur"),
          ...captionTracks
        ];

        for (const track of candidateTracks) {
          if (!track || !track.baseUrl) continue;
          try {
            const res = await fetch(track.baseUrl);
            if (!res.ok) continue;
            const rawText = await res.text();
            
            if (rawText.includes("<text")) {
              const matches = rawText.matchAll(/<text\s+start="([\d.]+)"\s+(?:dur="([\d.]+)"\s+)?(?:[^>]*>)([\s\S]*?)<\/text>/gi);
              for (const match of matches) {
                const start = parseFloat(match[1] || "0");
                const duration = parseFloat(match[2] || "0");
                const text = (match[3] || "")
                  .replace(/&amp;/g, "&")
                  .replace(/&lt;/g, "<")
                  .replace(/&gt;/g, ">")
                  .replace(/&quot;/g, '"')
                  .replace(/&#39;/g, "'")
                  .replace(/&apos;/g, "'")
                  .trim();
                if (text) {
                  transcript.push({ text, start, duration });
                }
              }
              if (transcript.length > 0) break;
            }
          } catch (e) {
            console.warn("Background caption fetch error:", e);
          }
        }

        sendResponse({ success: true, transcript: transcript.length > 0 ? transcript : null });
      } catch (err: any) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  if (message.type === "GET_EMBEDDING") {
    (async () => {
      try {
        await createOffscreenDocument();
        const response = await chrome.runtime.sendMessage({
          type: "CALCULATE_EMBEDDING_OFFSCREEN",
          text: message.text
        });
        sendResponse(response);
      } catch (err: any) {
        console.error("Service worker embedding forwarding error:", err);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true; // keeps port active
  }

  if (message.type === "FORWARD_PDF_TO_OFFSCREEN") {
    (async () => {
      try {
        await createOffscreenDocument();
        const response = await chrome.runtime.sendMessage({
          type: "PARSE_AND_VECTORIZE_PDF",
          arrayBuffer: message.arrayBuffer,
          documentId: message.documentId
        });
        sendResponse(response);
      } catch (err: any) {
        console.error("Service worker PDF forwarding error:", err);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true; // keeps port active
  }

  if (message.type === "FETCH_MODELS") {
    (async () => {
      try {
        const list = await fetchModelsFromApi(message.provider, message.apiKey, message.customUrl);
        sendResponse({ success: true, models: list });
      } catch (err: any) {
        console.error(`Error fetching models for ${message.provider}:`, err);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true; // keeps port active
  }

  if (message.type === "PERFORM_WEB_SEARCH") {
    (async () => {
      try {
        const query = message.query || "";
        if (!query) {
          sendResponse({ success: false, error: "Empty query provided." });
          return;
        }

        console.log(`Performing web search for: "${query}"`);
        const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
        
        const response = await fetch(searchUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
          }
        });
        
        if (!response.ok) {
          throw new Error(`DuckDuckGo request failed with status ${response.status}`);
        }
        
        const html = await response.text();
        
        await createOffscreenDocument();
        const parseRes = await chrome.runtime.sendMessage({
          type: "PARSE_DDG_SEARCH",
          html
        });

        if (!parseRes || !parseRes.success) {
          throw new Error(parseRes?.error || "Failed to parse search results.");
        }

        const results = parseRes.results || [];
        
        // Fetch top 2 pages for deep search content context
        const pagePromises = results.slice(0, 2).map(async (res: any) => {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 4000);
            const pageRes = await fetch(res.url, {
              signal: controller.signal,
              headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
              }
            });
            clearTimeout(timeoutId);
            
            if (!pageRes.ok) return null;
            const pageHtml = await pageRes.text();
            
            const cleanRes = await chrome.runtime.sendMessage({
              type: "CLEAN_PAGE_HTML",
              html: pageHtml
            });
            
            if (cleanRes && cleanRes.success) {
              return {
                title: res.title,
                url: res.url,
                snippet: res.snippet,
                content: cleanRes.text
              };
            }
          } catch (e: any) {
            console.warn(`Failed to fetch deep search page content for ${res.url}:`, e.message);
          }
          return null;
        });

        const pages = await Promise.all(pagePromises);
        const validPages = pages.filter(Boolean);

        sendResponse({
          success: true,
          results,
          pages: validPages
        });
      } catch (err: any) {
        console.error("Web search failed:", err);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true; // Keep port open for async response
  }

  // Programmatically inject content.js into the active tab as a fallback
  // This handles tabs that were open before the extension was installed/updated
  if (message.type === "INJECT_CONTENT_SCRIPT") {
    (async () => {
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tabId = tabs[0]?.id;
        if (!tabId) {
          sendResponse({ success: false, error: "No active tab found." });
          return;
        }
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ["content.js"]
        });
        sendResponse({ success: true });
      } catch (err: any) {
        // Injection may fail on chrome:// or extension pages — that's expected
        console.warn("Content script injection failed:", err.message);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  return false;
});
