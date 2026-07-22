import { useState, useRef, useEffect } from "react";
import { 
  Settings as SettingsIcon, 
  Send, 
  Cpu, 
  Check, 
  Server,
  CloudLightning,
  ChevronUp,
  Info,
  Moon,
  Sun,
  Key,
  Globe,
  Plus,
  Trash2,
  MessageSquare,
  Sparkles,
  PenTool,
  FileText,
  Loader2,
  CheckCircle2,
  AlertCircle,
  X,
  Upload,
  Crop,
  ImageIcon,
  Play,
  Search
} from "lucide-react";
import { LocalDb } from "./lib/db";
import { CloudSync } from "./lib/sync";
import type { DbSession, DbMessage, DbDocument } from "./lib/db";
import { MarkdownRenderer } from "./components/MarkdownRenderer";

type BgPresetKey = "midnight" | "sunset" | "forest" | "ocean" | "monochrome";

interface PresetConfig {
  name: string;
  canvas: string;
  blobs: string[];
}

const bgPresets: Record<BgPresetKey, PresetConfig> = {
  midnight: {
    name: "Midnight Space",
    canvas: "bg-[#060310]",
    blobs: ["bg-indigo-500/35", "bg-purple-600/30", "bg-violet-800/25"]
  },
  sunset: {
    name: "Sunset Vibrancy",
    canvas: "bg-[#180808]",
    blobs: ["bg-orange-500/25", "bg-rose-600/30", "bg-amber-800/25"]
  },
  forest: {
    name: "Emerald Forest",
    canvas: "bg-[#020b08]",
    blobs: ["bg-emerald-500/25", "bg-teal-600/30", "bg-green-800/25"]
  },
  ocean: {
    name: "Deep Blue Ocean",
    canvas: "bg-[#03091a]",
    blobs: ["bg-blue-500/35", "bg-cyan-600/30", "bg-sky-800/25"]
  },
  monochrome: {
    name: "Obsidian Slate",
    canvas: "bg-[#0d0e12]",
    blobs: ["bg-zinc-500/20", "bg-slate-600/20", "bg-neutral-800/20"]
  }
};

const parseSuggestedQuestions = (text: string) => {
  if (!text) return { cleanText: "", questions: [] as string[] };
  
  const startTag = "<suggested_questions>";
  const startIdx = text.indexOf(startTag);
  if (startIdx !== -1) {
    const cleanText = text.substring(0, startIdx).trim();
    const remaining = text.substring(startIdx + startTag.length).trim();
    
    // Find the end of the JSON array (the last matching ']')
    const endArrayIdx = remaining.lastIndexOf("]");
    if (endArrayIdx !== -1) {
      const jsonStr = remaining.substring(0, endArrayIdx + 1).trim();
      try {
        const list = JSON.parse(jsonStr);
        if (Array.isArray(list)) {
          return { cleanText, questions: list };
        }
      } catch (e) {
        // Fallback: regex scan string elements inside bracket if JSON parse fails
        try {
          const items = [...jsonStr.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/g)].map(m => m[1]);
          if (items.length > 0) {
            return { cleanText, questions: items };
          }
        } catch (err) {}
      }
    } else {
      // If array is not closed, scan for quoted elements anyway
      try {
        const items = [...remaining.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/g)].map(m => m[1]);
        if (items.length > 0) {
          return { cleanText, questions: items };
        }
      } catch (err) {}
    }
    return { cleanText, questions: [] as string[] };
  }
  return { cleanText: text, questions: [] as string[] };
};

function App() {
  const [sessions, setSessions] = useState<DbSession[]>([]);
  const [activeSession, setActiveSession] = useState<DbSession | null>(null);
  const [messages, setMessages] = useState<DbMessage[]>([]);
  const [input, setInput] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  
  const [activeModel, setActiveModel] = useState("gemini-nano");
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const [isConnected] = useState(true);
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [bgPreset, setBgPreset] = useState<BgPresetKey>("midnight");
  const [enableCloudSync, setEnableCloudSync] = useState(false);
  
  const [apiKeys, setApiKeys] = useState({
    groq: "",
    groqModel: "llama-3.3-70b-specdec",
    openrouter: "",
    openrouterModel: "meta-llama/llama-3-8b-instruct:free",
    openai: "",
    openaiModel: "gpt-4o-mini",
    deepseek: "",
    deepseekModel: "deepseek-chat",
    claude: "",
    claudeModel: "claude-3-5-sonnet-20241022",
    mistral: "",
    mistralModel: "mistral-small-latest",
    customUrl: "",
    customModel: "",
    customKey: "",
    supabaseUrl: "",
    supabaseKey: ""
  });

  const [fetchedModels, setFetchedModels] = useState<{ [key: string]: string[] }>({
    openai: [],
    claude: ["claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022", "claude-3-opus-20240229"],
    deepseek: [],
    groq: [],
    openrouter: [],
    mistral: [],
    custom: []
  });

  const [loadingModels, setLoadingModels] = useState<string | null>(null);
  const [isLocalAiAvailable, setIsLocalAiAvailable] = useState(false);
  const [isRagEnabled, setIsRagEnabled] = useState(true);
  const [documents, setDocuments] = useState<DbDocument[]>([]);
  const [indexingProgress, setIndexingProgress] = useState<{ [id: string]: number }>({});
  const [isUploading, setIsUploading] = useState(false);
  const [pageMcpContext, setPageMcpContext] = useState<{
    available: boolean;
    registryName?: string;
    tools: { name: string; description: string; parameters: Record<string, string> }[];
    url: string;
  } | null>(null);

  const [isWebSearchEnabled, setIsWebSearchEnabled] = useState(false);
  const [isWebSearchLoading, setIsWebSearchLoading] = useState(false);
  const [screenshotAttachment, setScreenshotAttachment] = useState<string | null>(null);

  // YouTube watch helper states
  const [youtubeVideoId, setYoutubeVideoId] = useState("");
  const [youtubeTitle, setYoutubeTitle] = useState("");
  const [youtubeTranscript, setYoutubeTranscript] = useState<Array<{ text: string; start: number; duration: number }> | null>(null);
  const [youtubeDescription, setYoutubeDescription] = useState("");
  const [isYoutubeHelperOpen, setIsYoutubeHelperOpen] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const streamingIdRef = useRef<string | null>(null);
  const streamingSessionIdRef = useRef<string | null>(null);
  const agentLoopCountRef = useRef(0);
  const currentSearchSourcesRef = useRef<any[]>([]);
  const currentOcrProviderRef = useRef<string | null>(null);

  // 1. Initialize IndexedDB and load sessions
  useEffect(() => {
    const initializeApp = async () => {
      try {
        await LocalDb.init();
        await loadSessions();
        await loadDocuments();

        // Load configuration keys & models list from chrome storage
        chrome.storage.local.get(
          ["apiKeys", "theme", "bgPreset", "enableCloudSync", "isRagEnabled", "activeModel", "fetchedModels"], 
          (res) => {
            if (res.apiKeys) setApiKeys(prev => ({ ...prev, ...(res.apiKeys as typeof apiKeys) }));
            if (res.theme) setTheme(res.theme as "light" | "dark");
            if (res.bgPreset) setBgPreset(res.bgPreset as BgPresetKey);
            if (res.enableCloudSync !== undefined) setEnableCloudSync(!!res.enableCloudSync);
            if (res.isRagEnabled !== undefined) setIsRagEnabled(!!res.isRagEnabled);
            if (res.activeModel) setActiveModel(res.activeModel as string);
            if (res.fetchedModels) {
              setFetchedModels(prev => ({ ...prev, ...(res.fetchedModels as typeof fetchedModels) }));
            }
          }
        );

        // Check local Gemini Nano capabilities
        // @ts-ignore
        if (typeof ai !== "undefined" && ai.languageModel) {
          // @ts-ignore
          const capabilities = await ai.languageModel.capabilities();
          if (capabilities.available !== "no") {
            setIsLocalAiAvailable(true);
          }
        }
      } catch (err) {
        console.error("Initialization error:", err);
      }
    };
    initializeApp();
  }, []);

  // 1.5. Cloud Database Sync Loop Effect
  useEffect(() => {
    if (!enableCloudSync || !apiKeys.supabaseUrl || !apiKeys.supabaseKey) return;

    // Run initial sync on load or toggle
    CloudSync.sync().catch(err => console.error("Initial CloudSync failed:", err));

    // Run a periodic sync every 30 seconds
    const interval = setInterval(() => {
      CloudSync.sync().catch(err => console.error("Periodic CloudSync failed:", err));
    }, 30000);

    return () => clearInterval(interval);
  }, [enableCloudSync, apiKeys.supabaseUrl, apiKeys.supabaseKey]);

  // Helper to crop image in side panel context using canvas
  const cropImage = (
    dataUrl: string,
    x: number,
    y: number,
    w: number,
    h: number,
    dpr: number
  ) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(
          img,
          x * dpr,
          y * dpr,
          w * dpr,
          h * dpr,
          0,
          0,
          w * dpr,
          h * dpr
        );
        const cropped = canvas.toDataURL("image/png");
        setScreenshotAttachment(cropped);
      }
    };
    img.src = dataUrl;
  };

  useEffect(() => {
    const handleOcrMessage = (message: any) => {
      if (message.type === "OCR_REGION_SELECTED") {
        chrome.tabs.captureVisibleTab(chrome.windows.WINDOW_ID_CURRENT, { format: "png" }, (dataUrl) => {
          if (chrome.runtime.lastError || !dataUrl) {
            const reason = chrome.runtime.lastError?.message || "No screenshot data returned.";
            console.error("Tab capture failed:", reason);
            alert(`Could not capture the screen: ${reason}`);
            return;
          }
          cropImage(dataUrl, message.x, message.y, message.width, message.height, message.dpr);
        });
      }
    };

    chrome.runtime.onMessage.addListener(handleOcrMessage);
    return () => {
      chrome.runtime.onMessage.removeListener(handleOcrMessage);
    };
  }, []);

  useEffect(() => {
    const checkActiveTabForYoutube = async () => {
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tab = tabs[0];
        if (tab?.url?.includes("youtube.com/watch")) {
          if (tab.id) {
            chrome.tabs.sendMessage(tab.id, { type: "GET_YOUTUBE_TRANSCRIPT" }, (response) => {
              if (response && response.success) {
                setYoutubeVideoId(response.videoId);
                setYoutubeTitle(response.title);
                setYoutubeTranscript(response.transcript);
                setYoutubeDescription(response.description || "");
              } else {
                setYoutubeVideoId(tab.url!.split("v=")[1]?.split("&")[0] || "");
                setYoutubeTitle(tab.title || "YouTube Video");
                setYoutubeTranscript(null);
                setYoutubeDescription("");
              }
            });
          }
        } else {
          setYoutubeVideoId("");
          setYoutubeTitle("");
          setYoutubeTranscript(null);
          setYoutubeDescription("");
        }
      } catch (e) {
        // Not active tab or restricted
      }
    };

    checkActiveTabForYoutube();

    const tabListener = () => {
      checkActiveTabForYoutube();
    };

    chrome.tabs.onActivated.addListener(tabListener);
    chrome.tabs.onUpdated.addListener(tabListener);
    return () => {
      chrome.tabs.onActivated.removeListener(tabListener);
      chrome.tabs.onUpdated.removeListener(tabListener);
    };
  }, []);

  // Helper to wait until a tab has finished navigating/loading (complete status)
  // Prevents sending messages or injecting scripts while the page is transient/unloading
  const waitForTabToLoad = (tabId: number): Promise<void> => {
    return new Promise((resolve) => {
      let attempts = 0;
      const checkTab = () => {
        attempts++;
        if (attempts > 25) { // 25 attempts * 200ms = 5 seconds timeout limit
          resolve();
          return;
        }
        chrome.tabs.get(tabId, (tab) => {
          if (chrome.runtime.lastError || !tab) {
            resolve();
            return;
          }
          if (tab.status === "complete") {
            resolve();
          } else {
            setTimeout(checkTab, 200);
          }
        });
      };
      checkTab();
    });
  };

  // Core helper: send a message to the content script in the active tab.
  // Auto-injects the content script if missing, and guards against non-injectable pages.
  const sendToActiveTab = (msg: any): Promise<any> => {
    return new Promise((resolve, reject) => {
      chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
        const tab = tabs[0];
        const tabId = tab?.id;
        if (!tabId) { reject(new Error("No active tab found.")); return; }

        // Guard: content scripts cannot be injected into internal Chrome pages
        const url = tab.url || "";
        const BLOCKED_PROTOCOLS = ["chrome://", "chrome-extension://", "about:", "edge://", "brave://", "data:", "file://", "devtools://"];
        const isBlocked = BLOCKED_PROTOCOLS.some(p => url.startsWith(p));
        if (isBlocked) {
          reject(new Error(
            `Cannot access this page (${url.split("/")[0]}//...). ` +
            `Please navigate to a regular website (like google.com or any webpage) before using page actions.`
          ));
          return;
        }

        // Wait for tab loading to finish if it's currently in progress
        if (tab.status === "loading") {
          console.log("Tab is currently loading. Waiting for navigation to settle...");
          await waitForTabToLoad(tabId);
        }

        // Send script query message with self-healing retry logic
        const attemptSendMessage = (retriesLeft: number) => {
          chrome.tabs.sendMessage(tabId, msg, (response) => {
            if (chrome.runtime.lastError) {
              if (retriesLeft > 0) {
                console.log(`Content script connection failed. Requesting programmatic injection fallback (${retriesLeft} retries left)...`);
                chrome.runtime.sendMessage({ type: "INJECT_CONTENT_SCRIPT" }, () => {
                  setTimeout(() => {
                    attemptSendMessage(retriesLeft - 1);
                  }, 400);
                });
              } else {
                reject(new Error("Content script unavailable. Please refresh the page."));
              }
            } else {
              resolve(response);
            }
          });
        };

        attemptSendMessage(2);
      });
    });
  };

  // Tabbed Layout state ("chat" | "write" | "translate" | "settings")
  const [activeTab, setActiveTab] = useState<"chat" | "write" | "translate" | "settings">("chat");

  // Write Mode Panel States
  const [writeTopic, setWriteTopic] = useState("");
  const [writeFormat, setWriteFormat] = useState("Paragraph");
  const [writeTone, setWriteTone] = useState("Professional");
  const [writeLength, setWriteLength] = useState("Medium");
  const [writeResult, setWriteResult] = useState("");
  const [isWriting, setIsWriting] = useState(false);

  // Translate Mode Panel States
  const [translateText, setTranslateText] = useState("");
  const [translateSource, setTranslateSource] = useState("Auto Detect");
  const [translateTarget, setTranslateTarget] = useState("Spanish");
  const [translateResult, setTranslateResult] = useState("");
  const [isTranslating, setIsTranslating] = useState(false);

  // Write result page insertion action
  const handleInsertTextIntoPage = async (textToInsert: string) => {
    try {
      const res = await sendToActiveTab({ type: "INSERT_TEXT", text: textToInsert });
      if (res && res.success) {
        console.log("Successfully inserted text into active element.");
      } else {
        alert(res?.error || "Could not insert text. Make sure you click/focus inside a webpage text field first.");
      }
    } catch (err: any) {
      alert("Error inserting text: " + err.message);
    }
  };

  // Write Template Generator Action
  const handleWriteGenerate = async () => {
    if (!writeTopic.trim()) return;
    setWriteResult("");
    setIsWriting(true);
    setIsGenerating(true);

    const formatPrompt = `Write a ${writeFormat} about the following topic: "${writeTopic}".
The tone of writing should be ${writeTone}.
The length of writing should be ${writeLength}.
Output ONLY the generated writing. Do not include any introductory or concluding conversational remarks. Do not use code block wrappers.`;

    try {
      let fullText = "";

      await chrome.runtime.sendMessage({
        type: "GENERATE_STREAM",
        prompt: formatPrompt,
        history: [],
        model: activeModel,
        keys: apiKeys
      });

      const chunkListener = (message: any) => {
        if (message.target === "inline-composer") return;
        if (message.type === "STREAM_CHUNK" && message.text) {
          fullText += message.text;
          setWriteResult(fullText);
        } else if (message.type === "STREAM_COMPLETE") {
          chrome.runtime.onMessage.removeListener(chunkListener);
          setIsWriting(false);
          setIsGenerating(false);
        } else if (message.type === "STREAM_ERROR") {
          chrome.runtime.onMessage.removeListener(chunkListener);
          setWriteResult(prev => prev + `\n\n[Generation Error: ${message.error}]`);
          setIsWriting(false);
          setIsGenerating(false);
        }
      };

      chrome.runtime.onMessage.addListener(chunkListener);
    } catch (err: any) {
      setWriteResult(`Error starting generation: ${err.message}`);
      setIsWriting(false);
      setIsGenerating(false);
    }
  };

  // Translate Action
  const handleTranslate = async () => {
    if (!translateText.trim()) return;
    setTranslateResult("");
    setIsTranslating(true);
    setIsGenerating(true);

    const translatePrompt = `Translate the following text from ${translateSource} to ${translateTarget}:
"${translateText}"
Output ONLY the translated text. Do not include any introductory, explanatory, or concluding remarks.`;

    try {
      let fullText = "";

      await chrome.runtime.sendMessage({
        type: "GENERATE_STREAM",
        prompt: translatePrompt,
        history: [],
        model: activeModel,
        keys: apiKeys
      });

      const chunkListener = (message: any) => {
        if (message.target === "inline-composer") return;
        if (message.type === "STREAM_CHUNK" && message.text) {
          fullText += message.text;
          setTranslateResult(fullText);
        } else if (message.type === "STREAM_COMPLETE") {
          chrome.runtime.onMessage.removeListener(chunkListener);
          setIsTranslating(false);
          setIsGenerating(false);
        } else if (message.type === "STREAM_ERROR") {
          chrome.runtime.onMessage.removeListener(chunkListener);
          setTranslateResult(prev => prev + `\n\n[Translation Error: ${message.error}]`);
          setIsTranslating(false);
          setIsGenerating(false);
        }
      };

      chrome.runtime.onMessage.addListener(chunkListener);
    } catch (err: any) {
      setTranslateResult(`Error starting translation: ${err.message}`);
      setIsTranslating(false);
      setIsGenerating(false);
    }
  };

  // Translate Page implementation
  const handleTranslatePage = async () => {
    setIsTranslating(true);
    setTranslateResult("Extracting page content to translate...");
    try {
      const res = await sendToActiveTab({ type: "EXTRACT_PAGE_CONTENT" });
      if (!res || !res.success || !res.text) {
        throw new Error(res?.error || "Could not scrape clean text from active webpage.");
      }
      
      setTranslateResult(`Translating page content from ${translateSource} to ${translateTarget}...`);
      
      const pageText = res.text.slice(0, 1500); // Translate first 1500 chars to avoid model context bounds
      const translatePrompt = `Translate the following webpage content from ${translateSource} to ${translateTarget}:
"${pageText}"
Output ONLY the translated text. Do not include any introductory, explanatory, or concluding remarks.`;

      setIsGenerating(true);
      let fullText = "";

      await chrome.runtime.sendMessage({
        type: "GENERATE_STREAM",
        prompt: translatePrompt,
        history: [],
        model: activeModel,
        keys: apiKeys
      });

      const chunkListener = (message: any) => {
        if (message.target === "inline-composer") return;
        if (message.type === "STREAM_CHUNK" && message.text) {
          fullText += message.text;
          setTranslateResult(fullText);
        } else if (message.type === "STREAM_COMPLETE") {
          chrome.runtime.onMessage.removeListener(chunkListener);
          setIsTranslating(false);
          setIsGenerating(false);
        } else if (message.type === "STREAM_ERROR") {
          chrome.runtime.onMessage.removeListener(chunkListener);
          setTranslateResult(prev => prev + `\n\n[Translation Error: ${message.error}]`);
          setIsTranslating(false);
          setIsGenerating(false);
        }
      };

      chrome.runtime.onMessage.addListener(chunkListener);
    } catch (err: any) {
      setTranslateResult(`Error translating page: ${err.message}`);
      setIsTranslating(false);
      setIsGenerating(false);
    }
  };
  // Quick action text selection handler (Phase 2)
  const handleQuickAction = async (action: string, selectedText: string) => {
    // 1. Resolve or create active session
    let targetSession = activeSession;
    if (!targetSession) {
      const list = await LocalDb.getSessions();
      if (list.length > 0) {
        targetSession = list[0];
        setActiveSession(list[0]);
      } else {
        const newSess = await LocalDb.createSession("Quick Assistant Session");
        targetSession = newSess;
        setActiveSession(newSess);
        const refreshed = await LocalDb.getSessions();
        setSessions(refreshed);
      }
    }

    if (!targetSession) return;

    // Load target session messages first
    const sessionMsgs = await LocalDb.getMessages(targetSession.id);
    setMessages(sessionMsgs);

    // 2. Formulate prompt
    const prompt = `${action} the following text:\n\n"${selectedText}"`;

    // 3. Add user message
    const userMsg = await LocalDb.addMessage(targetSession.id, "user", prompt);
    const latestMessages = [...sessionMsgs, userMsg];
    setMessages(latestMessages);

    // Reset agent loop counter on quick action
    agentLoopCountRef.current = 0;

    // 4. Trigger streaming execution
    executeModelStream(prompt, targetSession.id, latestMessages);
  };

  // Summarize current active webpage content (Phase 3)
  const handleSummarizePage = async () => {
    // 1. Resolve or create active session
    let targetSession = activeSession;
    if (!targetSession) {
      const list = await LocalDb.getSessions();
      if (list.length > 0) {
        targetSession = list[0];
        setActiveSession(list[0]);
      } else {
        const newSess = await LocalDb.createSession("Web Page Summary");
        targetSession = newSess;
        setActiveSession(newSess);
        const refreshed = await LocalDb.getSessions();
        setSessions(refreshed);
      }
    }

    if (!targetSession) return;

    // Load active session messages first
    const sessionMsgs = await LocalDb.getMessages(targetSession.id);
    setMessages(sessionMsgs);

    // Show visual status log in chat
    const logMsg = await LocalDb.addMessage(targetSession.id, "assistant", `[Scraping webpage text content...]`);
    let runningMsgs = [...sessionMsgs, logMsg];
    setMessages(runningMsgs);

    try {
      // 2. Scrape webpage content via sendToActiveTab helper
      const res = await sendToActiveTab({ type: "EXTRACT_PAGE_CONTENT" });
      if (!res || !res.success) {
        throw new Error(res?.error || "Could not extract page text.");
      }

      // Update log message to show success
      const successLog = await LocalDb.addMessage(targetSession.id, "assistant", `[✓ Successfully scraped page: "${res.title}"]`);
      runningMsgs = [...sessionMsgs, successLog];
      setMessages(runningMsgs);

      // 3. Formulate the prompt
      const prompt = `Summarize the active webpage in structured bullet points, detailing key takeaways.
URL: ${res.url}
Title: ${res.title}

Content:
${res.text}`;

      // 4. Add the prompt as user message
      const userMsg = await LocalDb.addMessage(targetSession.id, "user", `Summarize the current page: "${res.title}"`);
      runningMsgs = [...runningMsgs, userMsg];
      setMessages(runningMsgs);

      // Reset agent loop counter on summarize page action
      agentLoopCountRef.current = 0;

      // 5. Run the model stream
      executeModelStream(prompt, targetSession.id, runningMsgs);
    } catch (err: any) {
      const errMsg = await LocalDb.addMessage(targetSession.id, "assistant", `[✗ Page Scraping Failed: ${err.message}]`);
      setMessages([...sessionMsgs, errMsg]);
    }
  };

  const handleOcrCapture = async () => {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs[0];
      if (!tab?.id) {
        alert("Please open a normal webpage first.");
        return;
      }
      
      try {
        await chrome.tabs.sendMessage(tab.id, { type: "PING" });
      } catch (err) {
        console.log("Content script not active. Injecting content script...");
        await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage({ type: "INJECT_CONTENT_SCRIPT" }, (res) => {
            if (res && res.success) resolve(null);
            else reject(new Error(res?.error || "Failed to inject content script"));
          });
        });
        await new Promise(r => setTimeout(r, 200)); // small delay to let script load
      }
      
      chrome.tabs.sendMessage(tab.id, { type: "START_OCR_CAPTURE" }, () => {
        if (chrome.runtime.lastError) {
          console.warn("OCR Capture start error:", chrome.runtime.lastError.message);
        }
      });
    } catch (e: any) {
      alert(`Could not start OCR Capture: ${e.message}`);
    }
  };

  const handleYoutubeSeek = async (time: number) => {
    try {
      await sendToActiveTab({ type: "YOUTUBE_SEEK", time });
    } catch (err: any) {
      console.warn("Could not seek video playhead:", err);
    }
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const handleSummarizeYoutubeVideo = async () => {
    if (!youtubeVideoId || !activeSession) return;

    const targetSession = activeSession;
    const userMsg = await LocalDb.addMessage(targetSession.id, "user", `Summarize this YouTube video: "${youtubeTitle}"`);
    const latestMessages = [...messages, userMsg];
    setMessages(latestMessages);

    agentLoopCountRef.current = 0;

    if (youtubeTranscript) {
      const transcriptText = youtubeTranscript.map(t => `[${formatTime(t.start)}] ${t.text}`).join("\n");
      const summaryPrompt = `Provide a comprehensive structured summary of the YouTube video titled "${youtubeTitle}" using the transcript below.
Highlight the key topics discussed with timestamps, main arguments, and actionable takeaways in structured bullet points.

Transcript:
${transcriptText}`;
      executeModelStream(summaryPrompt, targetSession.id, latestMessages);
    } else {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0];
        if (tab?.id) {
          chrome.tabs.sendMessage(tab.id, { type: "GET_YOUTUBE_TRANSCRIPT" }, (response) => {
            const desc = (response && response.success) ? response.description : "";
            const summaryPrompt = `Provide a comprehensive structured summary of the YouTube video titled "${youtubeTitle}" using the video description below.
Highlight the main topics and key takeaways in structured bullet points.

Video Description:
${desc || "No description available."}`;
            executeModelStream(summaryPrompt, targetSession.id, latestMessages);
          });
        } else {
          executeModelStream(`Summarize the video titled "${youtubeTitle}".`, targetSession.id, latestMessages);
        }
      });
    }
  };

  const quickActionRef = useRef(handleQuickAction);
  useEffect(() => {
    quickActionRef.current = handleQuickAction;
  }, [handleQuickAction]);

  // Listener for quick actions sent from page highlight tooltips
  useEffect(() => {
    const checkPendingQuickAction = () => {
      chrome.storage.local.get(["pendingQuickAction"], (res) => {
        if (res.pendingQuickAction) {
          const { action, text, timestamp } = res.pendingQuickAction as any;
          // Only process if it was triggered in the last 15 seconds (prevents processing old stored actions on reload)
          if (Date.now() - timestamp < 15000) {
            console.log("Visper: Found pending quick action:", action, text);
            setActiveTab("chat");
            quickActionRef.current(action, text);
          }
          // Clear pending action in storage
          chrome.storage.local.remove(["pendingQuickAction"]);
        }
      });
    };

    // Check immediately on startup
    checkPendingQuickAction();

    // Listen for changes in storage (for when the sidebar is already open)
    const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (changes.pendingQuickAction?.newValue) {
        checkPendingQuickAction();
      }
    };
    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => chrome.storage.onChanged.removeListener(handleStorageChange);
  }, [activeSession]);

  // 1.8. WebMCP Page Context Discovery Effect
  useEffect(() => {
    const checkActiveTabMcp = async () => {
      try {
        const response = await sendToActiveTab({ type: "CHECK_WEBMCP" });
        if (response) setPageMcpContext(response);
      } catch (err) {
        // Page not injectable (e.g., chrome:// pages) — silently ignore
        setPageMcpContext(null);
        console.debug("WebMCP tab check skipped:", err);
      }
    };

    // Run initial tab check
    checkActiveTabMcp();

    // Listen for dynamic page registrations from content scripts
    const handleRuntimeMessage = (message: any) => {
      if (message.type === "WEBMCP_PAGE_REGISTERED") {
        setPageMcpContext({
          available: true,
          registryName: message.registryName,
          tools: message.tools,
          url: message.url
        });
      } else if (message.type === "TEXT_SELECTION_ACTION") {
        // Call via ref to avoid stale closures in event listener
        quickActionRef.current(message.action, message.text);
      } else if (message.type === "INDEXING_PROGRESS") {
        setIndexingProgress(prev => ({
          ...prev,
          [message.documentId]: message.progress
        }));
        // Proactively reload metadata to sync UI status states
        LocalDb.getDocuments().then(list => setDocuments(list)).catch(() => {});
      }
    };
    chrome.runtime.onMessage.addListener(handleRuntimeMessage);

    // Check on tab focus change
    const onTabActivated = () => {
      checkActiveTabMcp();
    };
    chrome.tabs.onActivated.addListener(onTabActivated);

    return () => {
      chrome.runtime.onMessage.removeListener(handleRuntimeMessage);
      chrome.tabs.onActivated.removeListener(onTabActivated);
    };
  }, []);

  // 2. Load and switch sessions helper
  const loadSessions = async (selectSessionId?: string) => {
    const list = await LocalDb.getSessions();
    setSessions(list);

    if (list.length === 0) {
      // Create first default conversation session
      const defaultSession = await LocalDb.createSession("First Conversation");
      setSessions([defaultSession]);
      setActiveSession(defaultSession);
      await loadMessages(defaultSession.id);
    } else {
      const active = list.find(s => s.id === selectSessionId) || list[0];
      setActiveSession(active);
      await loadMessages(active.id);
    }
  };

  const loadMessages = async (sessionId: string) => {
    const msgs = await LocalDb.getMessages(sessionId);
    setMessages(msgs);
  };

  const createNewChat = async () => {
    const title = `Conversation ${sessions.length + 1}`;
    const newSession = await LocalDb.createSession(title);
    await loadSessions(newSession.id);
  };

  const deleteChat = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Avoid switching to the session before deleting
    await LocalDb.deleteSession(id);
    await loadSessions();
  };

  // Save settings helpers
  const saveSettings = (
    updatedKeys = apiKeys, 
    updatedTheme = theme, 
    updatedPreset = bgPreset, 
    sync = enableCloudSync, 
    rag = isRagEnabled,
    model = activeModel,
    modelsList = fetchedModels
  ) => {
    chrome.storage.local.set({
      apiKeys: updatedKeys,
      theme: updatedTheme,
      bgPreset: updatedPreset,
      enableCloudSync: sync,
      isRagEnabled: rag,
      activeModel: model,
      fetchedModels: modelsList
    });
  };

  // Dynamic Models Fetching routine via Background service worker
  const fetchModels = async (provider: string, apiKey: string, customUrl?: string) => {
    if (!apiKey && provider !== "claude") {
      alert(`Please enter the API key for ${provider} before fetching models.`);
      return;
    }
    
    setLoadingModels(provider);
    try {
      const res = await chrome.runtime.sendMessage({
        type: "FETCH_MODELS",
        provider,
        apiKey,
        customUrl
      });
      if (res && res.success && Array.isArray(res.models)) {
        const updatedList = { ...fetchedModels, [provider]: res.models };
        setFetchedModels(updatedList);
        saveSettings(apiKeys, theme, bgPreset, enableCloudSync, isRagEnabled, activeModel, updatedList);
      } else {
        alert(`Failed to fetch models: ${res?.error || "Unknown API response."}`);
      }
    } catch (err: any) {
      alert(`Connection failed: ${err.message}`);
    } finally {
      setLoadingModels(null);
    }
  };

  // --- Document Management (RAG) Helpers ---
  const loadDocuments = async () => {
    try {
      const list = await LocalDb.getDocuments();
      setDocuments(list);
    } catch (err) {
      console.error("Error loading documents:", err);
    }
  };

  const handleDocumentDelete = async (id: string) => {
    try {
      await LocalDb.deleteDocument(id);
      await loadDocuments();
    } catch (err) {
      console.error("Error deleting document:", err);
    }
  };

  const handleDocumentUpload = async (file: File) => {
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.endsWith(".pdf")) {
      alert("Only PDF documents are supported for local semantic search.");
      return;
    }

    setIsUploading(true);
    let doc: any = null;
    try {
      // 1. Create document record in IndexedDB
      doc = await LocalDb.createDocument(file.name, file.size);
      await loadDocuments(); // Show as processing immediately

      // 2. Read file as ArrayBuffer
      const reader = new FileReader();
      reader.onload = async () => {
        const arrayBuffer = reader.result as ArrayBuffer;
        try {
          // 3. Send message to service worker to pass to offscreen page
          const response = await chrome.runtime.sendMessage({
            type: "FORWARD_PDF_TO_OFFSCREEN",
            arrayBuffer,
            documentId: doc.id
          });

          if (response && response.success && response.chunks) {
            // 4. Save segments and 384d vectors to IndexedDB
            await LocalDb.addDocumentChunks(doc.id, response.chunks);
            await LocalDb.updateDocumentStatus(doc.id, "ready");
            console.log(`Document "${file.name}" indexed successfully with ${response.chunks.length} segments.`);
          } else {
            const errorMsg = response?.error || "WASM worker failed parsing.";
            await LocalDb.updateDocumentStatus(doc.id, "error", errorMsg);
            alert(`Failed indexing "${file.name}": ${errorMsg}`);
          }
        } catch (err: any) {
          await LocalDb.updateDocumentStatus(doc.id, "error", err.message);
          alert(`Failed sending file to parser: ${err.message}`);
        } finally {
          setIsUploading(false);
          await loadDocuments();
        }
      };
      
      reader.onerror = () => {
        throw new Error("Failed reading local PDF file data.");
      };

      reader.readAsArrayBuffer(file);
    } catch (err: any) {
      setIsUploading(false);
      if (doc) {
        await LocalDb.updateDocumentStatus(doc.id, "error", err.message);
      }
      alert(`Error uploading file: ${err.message}`);
      await loadDocuments();
    }
  };

  // Close custom model dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsModelDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Scroll to bottom when messages update
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Listener for background streaming messages
  useEffect(() => {
    const handleStreamMessage = (message: { type: string; text?: string; error?: string; target?: string; provider?: string }) => {
      if (message.target === "inline-composer") return;
      if (!streamingIdRef.current || !streamingSessionIdRef.current) return;

      if (message.type === "STREAM_CHUNK" && message.text) {
        const textToAppend = message.text;
        setMessages(prev => prev.map(msg => 
          msg.id === streamingIdRef.current 
            ? { ...msg, text: msg.text + textToAppend } 
            : msg
        ));
      } else if (message.type === "OCR_PROVIDER_USED") {
        currentOcrProviderRef.current = message.provider || null;
      } else if (message.type === "STREAM_COMPLETE") {
        const completedId = streamingIdRef.current;
        const completedSessionId = streamingSessionIdRef.current!;
        setMessages(prev => {
          const finalMsg = prev.find(m => m.id === completedId);
          if (finalMsg) {
            LocalDb.addMessage(
              completedSessionId,
              "assistant",
              finalMsg.text,
              undefined,
              undefined,
              currentSearchSourcesRef.current,
              currentOcrProviderRef.current || undefined
            ).then(saved => {
              setTimeout(() => {
                setMessages(currentMsgs => currentMsgs.map(m => m.id === completedId ? saved : m));
                
                // Execute potential agent automation action loops
                handleAgentAction(saved.text, prev.map(m => m.id === completedId ? saved : m), completedSessionId);

                triggerLocalEmbedding(saved.id, saved.text).then(() => {
                  if (enableCloudSync) CloudSync.sync().catch(console.error);
                });
              }, 0);
            });
          }
          return prev;
        });
        setIsGenerating(false);
        streamingIdRef.current = null;
      } else if (message.type === "STREAM_ERROR") {
        const errMsg = message.error || "An unknown stream error occurred.";
        setMessages(prev => prev.map(msg => 
          msg.id === streamingIdRef.current 
            ? { ...msg, text: `Error: ${errMsg}` } 
            : msg
        ));
        setIsGenerating(false);
        streamingIdRef.current = null;
      }
    };

    chrome.runtime.onMessage.addListener(handleStreamMessage);
    return () => chrome.runtime.onMessage.removeListener(handleStreamMessage);
  }, [activeSession]);

  // Background helper to request text vectorization from the offscreen context
  const triggerLocalEmbedding = async (messageId: string, text: string) => {
    try {
      console.log(`Requesting local embedding index for message ${messageId}...`);
      const response = await chrome.runtime.sendMessage({
        type: "GET_EMBEDDING",
        text: text
      });
      if (response && response.success && response.vector) {
        await LocalDb.updateMessageVector(messageId, response.vector);
        console.log(`Saved vector embeddings index to database for message ${messageId}.`);
      }
    } catch (err) {
      console.warn("Failed to index message vector locally:", err);
    }
  };

  const callPageTool = async (toolName: string, args: Record<string, any>) => {
    const response = await sendToActiveTab({
      type: "WEBMCP_CALL_TOOL",
      tool: toolName,
      arguments: args
    });
    if (response && response.success) return response.result;
    throw new Error(response?.error || "Tool call failed");
  };

  const performDomAction = async (action: string, tag?: string, text?: string, selector?: string, value?: string) => {
    const response = await sendToActiveTab({
      type: "DOM_INTERACT",
      action,
      tag,
      text,
      selector,
      value
    });
    if (response && response.success) return response;
    throw new Error(response?.error || "DOM action failed");
  };

  const tryRepairJson = (raw: string): any => {
    let clean = raw.trim();
    if (!clean.startsWith('{')) return null;

    let inString = false;
    let escaped = false;
    for (let i = 0; i < clean.length; i++) {
      const char = clean[i];
      if (char === '\\') {
        escaped = !escaped;
      } else if (char === '"' && !escaped) {
        inString = !inString;
        escaped = false;
      } else {
        escaped = false;
      }
    }

    if (inString) {
      clean += '"';
    }

    let braceCount = 0;
    let inStr = false;
    let esc = false;
    for (let i = 0; i < clean.length; i++) {
      const char = clean[i];
      if (char === '\\') {
        esc = !esc;
      } else if (char === '"' && !esc) {
        inStr = !inStr;
        esc = false;
      } else if (!inStr) {
        if (char === '{') braceCount++;
        if (char === '}') braceCount--;
        esc = false;
      } else {
        esc = false;
      }
    }

    while (braceCount > 0) {
      clean += '}';
      braceCount--;
    }

    try {
      return JSON.parse(clean);
    } catch (e) {
      return null;
    }
  };

  const handleAgentAction = async (text: string, currentMessages: DbMessage[], sessionId: string) => {
    const actionBlocks: any[] = [];

    // 1. Try finding markdown code blocks — including UNCLOSED ones at stream end
    // The (?:```|$) means: match either a closing ``` OR end-of-string.
    // This handles streams cut off mid-block (missing closing backticks).
    const blockRegex = /```(?:json)?\s*([\s\S]+?)(?:\s*```|$)/g;
    let m;
    while ((m = blockRegex.exec(text)) !== null) {
      const blockText = m[1].trim();
      if (!blockText.startsWith('{')) continue; // skip non-JSON blocks (code examples, etc.)
      try {
        const parsed = JSON.parse(blockText);
        if (parsed.action) actionBlocks.push(parsed);
      } catch (e) {
        // JSON is incomplete (stream was truncated) — try to repair it
        const repaired = tryRepairJson(blockText);
        if (repaired && repaired.action) actionBlocks.push(repaired);
      }
    }

    // 2. If no actions found in code blocks, look for bare JSON blocks
    if (actionBlocks.length === 0) {
      const bareRegex = /\{[\s\S]+?(?:\}|$)/g;
      let bareMatch;
      while ((bareMatch = bareRegex.exec(text)) !== null) {
        const bareText = bareMatch[0].trim();
        try {
          const parsed = JSON.parse(bareText);
          if (parsed.action) actionBlocks.push(parsed);
        } catch (e) {
          const repaired = tryRepairJson(bareText);
          if (repaired && repaired.action) actionBlocks.push(repaired);
        }
      }
    }

    if (actionBlocks.length === 0 || !sessionId) return;

    let runningMsgs = [...currentMessages];

    // Execute every action block in sequence
    for (const data of actionBlocks) {

      // A. WebMCP registered tool call
      if (data.action === "call_tool" && data.tool) {
        const logMsg = await LocalDb.addMessage(sessionId, "assistant", `[Tool Call: ${data.tool}]`);
        runningMsgs = [...runningMsgs, logMsg];
        setMessages([...runningMsgs]);

        try {
          const result = await callPageTool(data.tool, data.arguments || {});
          const resultMsg = await LocalDb.addMessage(sessionId, "assistant", `[Tool Result: ${JSON.stringify(result)}]`);
          runningMsgs = [...runningMsgs, resultMsg];
          setMessages([...runningMsgs]);
        } catch (err: any) {
          const errMsg = await LocalDb.addMessage(sessionId, "assistant", `[Tool Error: ${err.message}]`);
          runningMsgs = [...runningMsgs, errMsg];
          setMessages([...runningMsgs]);
        }
      }

      // B. Legacy DOM interaction (fill, click, focus, scroll, etc.)
      else if (data.action === "dom_interact" && data.domAction) {
        const label = data.text || data.selector || data.tag || "element";
        const logMsg = await LocalDb.addMessage(sessionId, "assistant",
          `[DOM ${data.domAction}: "${label}"${data.value ? ` → "${data.value}"` : ""}]`
        );
        runningMsgs = [...runningMsgs, logMsg];
        setMessages([...runningMsgs]);

        try {
          const result: any = await performDomAction(data.domAction, data.tag, data.text, data.selector, data.value);
          const successMsg = await LocalDb.addMessage(sessionId, "assistant", `[✓ ${result.message || "Done"}]`);
          runningMsgs = [...runningMsgs, successMsg];
          setMessages([...runningMsgs]);
        } catch (err: any) {
          const errMsg = await LocalDb.addMessage(sessionId, "assistant", `[✗ ${err.message}]`);
          runningMsgs = [...runningMsgs, errMsg];
          setMessages([...runningMsgs]);
        }

        // Small delay between sequential DOM writes for page rendering stability
        await new Promise(r => setTimeout(r, 150));
      }

      // C. Browser actions (open_tab, navigate, go_back, go_forward, close_tab)
      else if (data.action === "browser_action" && data.browserAction) {
        const actionType = data.browserAction;
        const targetUrl = data.url || "";
        
        const logMsg = await LocalDb.addMessage(sessionId, "assistant",
          `[Browser ${actionType}${targetUrl ? ` → "${targetUrl}"` : ""}]`
        );
        runningMsgs = [...runningMsgs, logMsg];
        setMessages([...runningMsgs]);

        try {
          let message = "Completed successfully";
          if (actionType === "open_tab") {
            if (!targetUrl) throw new Error("URL is required to open a new tab.");
            // If it has any scheme (e.g. about:, chrome://, mailto:), use as-is; otherwise prepend https://
            const finalUrl = targetUrl.match(/^[a-z0-9.+-]+:/i) ? targetUrl : `https://${targetUrl}`;
            await new Promise<void>((resolve, reject) => {
              chrome.tabs.create({ url: finalUrl }, () => {
                if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                else resolve();
              });
            });
            message = `Opened new tab with: ${finalUrl}`;
          }
          else if (actionType === "navigate") {
            if (!targetUrl) throw new Error("URL is required to navigate.");
            const finalUrl = targetUrl.match(/^[a-z0-9.+-]+:/i) ? targetUrl : `https://${targetUrl}`;
            await new Promise<void>((resolve, reject) => {
              chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                const activeTab = tabs[0];
                if (activeTab?.id) {
                  chrome.tabs.update(activeTab.id, { url: finalUrl }, () => {
                    if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                    else resolve();
                  });
                } else {
                  reject(new Error("No active tab found."));
                }
              });
            });
            message = `Navigated active tab to: ${finalUrl}`;
          }
          else if (actionType === "go_back") {
            await new Promise<void>((resolve, reject) => {
              chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                const activeTab = tabs[0];
                if (activeTab?.id) {
                  chrome.tabs.goBack(activeTab.id, () => {
                    if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                    else resolve();
                  });
                } else {
                  reject(new Error("No active tab found."));
                }
              });
            });
            message = `Went back to previous page.`;
          }
          else if (actionType === "go_forward") {
            await new Promise<void>((resolve, reject) => {
              chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                const activeTab = tabs[0];
                if (activeTab?.id) {
                  chrome.tabs.goForward(activeTab.id, () => {
                    if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                    else resolve();
                  });
                } else {
                  reject(new Error("No active tab found."));
                }
              });
            });
            message = `Went forward to next page.`;
          }
          else if (actionType === "close_tab") {
            await new Promise<void>((resolve, reject) => {
              chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                const activeTab = tabs[0];
                if (activeTab?.id) {
                  chrome.tabs.remove(activeTab.id, () => {
                    if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                    else resolve();
                  });
                } else {
                  reject(new Error("No active tab found."));
                }
              });
            });
            message = `Closed active tab.`;
          }
          else {
            throw new Error(`Unsupported browser action: ${actionType}`);
          }

          const successMsg = await LocalDb.addMessage(sessionId, "assistant", `[✓ ${message}]`);
          runningMsgs = [...runningMsgs, successMsg];
          setMessages([...runningMsgs]);
        } catch (err: any) {
          const errMsg = await LocalDb.addMessage(sessionId, "assistant", `[✗ ${err.message}]`);
          runningMsgs = [...runningMsgs, errMsg];
          setMessages([...runningMsgs]);
        }

        await new Promise(r => setTimeout(r, 150));
      }
    }

    // Final summary — re-trigger the model to process tool results and answer the user
    const doneMsg = await LocalDb.addMessage(sessionId, "assistant",
      `✅ Done — executed ${actionBlocks.length} action${actionBlocks.length > 1 ? "s" : ""} on the page.`
    );
    runningMsgs = [...runningMsgs, doneMsg];
    setMessages([...runningMsgs]);

    // Recursive agent loop: feed results back to the model
    if (agentLoopCountRef.current < 5) {
      agentLoopCountRef.current += 1;
      console.log(`Agent loop step ${agentLoopCountRef.current}/5. Re-triggering model to formulate final reply...`);
      executeModelStream(
        "System: The page action or tool execution has completed successfully. Please review the results in the conversation history and provide your final response, summary, or next actions to the user.",
        sessionId,
        runningMsgs
      );
    } else {
      console.warn("Max agent loop depth of 5 reached. Stopping recursion.");
      const limitMsg = await LocalDb.addMessage(sessionId, "assistant",
        `⚠️ Maximum agent loop limit reached (5 steps). Stopping further actions.`
      );
      setMessages(prev => [...prev, limitMsg]);
    }
  };

  const executeModelStream = async (
    userPrompt: string, 
    sessionId: string, 
    updatedMessagesList?: DbMessage[], 
    imageAttachment?: string, 
    searchSources?: any[]
  ) => {
    // Cache search sources in a ref for saving when stream completes
    currentSearchSourcesRef.current = searchSources || [];
    currentOcrProviderRef.current = null;

    // Placeholder message for assistant stream
    const aiMsgId = Math.random().toString();
    const aiPlaceholder: DbMessage = {
      id: aiMsgId,
      sessionId,
      sender: "assistant",
      text: "...",
      timestamp: new Date()
    };
    setMessages(prev => [...prev, aiPlaceholder]);
    setIsGenerating(true);
    streamingIdRef.current = aiMsgId;
    streamingSessionIdRef.current = sessionId;

    // 1. Build system instructions dynamically based on active page capabilities
    let systemInstructions = `You are Visper, a premium browser copilot assistant.
You can interact with the active webpage or control the browser.

RULES:
- If the user asks you to perform actions on a page (fill form, click button, etc.) or control tabs/navigation, ONLY output JSON action blocks — do NOT write explanatory text.
- To perform MULTIPLE actions, output MULTIPLE separate JSON blocks in sequence, one per action.
- ALL JSON blocks in your response will be executed sequentially and automatically.
- Do NOT re-explain what you are doing — just output the JSON blocks.
- If it is a normal conversation (not a page action request), answer normally without any JSON.
- At the very end of your response, please suggest 3 relevant follow-up questions the user might ask next. Format them as a JSON array inside a tag like this: <suggested_questions>["Question 1", "Question 2", "Question 3"]</suggested_questions>. Ensure the questions are brief (less than 8 words each) and highly contextually relevant.

BROWSER CONTROL CAPABILITIES:
You can control the browser's tabs and navigation using "browser_action" blocks:
\`\`\`json
{
  "action": "browser_action",
  "browserAction": "open_tab" | "navigate" | "close_tab" | "go_back" | "go_forward",
  "url": "https://example.com" (only required for open_tab and navigate)
}
\`\`\`
- If the user asks to "open a new tab and search for X" or "search for X", use "open_tab" with: "https://www.google.com/search?q=X" (properly URI-encoded).
- If the user asks to "search in the current tab" or similar, use "navigate" with: "https://www.google.com/search?q=X".
`;

    if (youtubeVideoId) {
      if (youtubeTranscript) {
        const transcriptStr = youtubeTranscript.slice(0, 150).map(t => `[${formatTime(t.start)}] ${t.text}`).join(" ");
        systemInstructions += `

ACTIVE YOUTUBE VIDEO CONTEXT:
The user is viewing a YouTube video in their active tab. You have access to the video's title and its full transcript text below. Use this directly to answer summaries, explanations, or questions about the video without needing to scrape the page.
Video Title: "${youtubeTitle}"
Video ID: "${youtubeVideoId}"
Transcript Content:
${transcriptStr.slice(0, 10000)}
`;
      } else if (youtubeDescription) {
        systemInstructions += `

ACTIVE YOUTUBE VIDEO CONTEXT (NO CAPTIONS):
The user is viewing a YouTube video in their active tab. Captions are not available, but you have access to the video's title and description details below. Use this directly to answer summaries, explanations, or questions about the video without needing to scrape the page.
Video Title: "${youtubeTitle}"
Video ID: "${youtubeVideoId}"
Video Description:
${youtubeDescription.slice(0, 6000)}
`;
      }
    }

    if (pageMcpContext?.available && pageMcpContext.tools.length > 0) {
      systemInstructions += `
The active webpage "${pageMcpContext.registryName}" has registered page-side tools via WebMCP:
${JSON.stringify(pageMcpContext.tools, null, 2)}

To call a tool, you MUST output a single JSON block inside a markdown code block:
\`\`\`json
{
  "action": "call_tool",
  "tool": "tool_name",
  "arguments": {
    "arg_name": "arg_value"
  }
}
\`\`\`
`;
    } else {
      systemInstructions += `
The user is viewing a LEGACY webpage (no WebMCP tools registered).
You can fill forms, click buttons, focus elements, and SCRAPE page text content using DOM interaction JSON blocks.

If the user asks questions about the current webpage (e.g. "summarize this page", "what is on this page", "list products here", "find text"), you MUST output the "extract_page_content" action first:
\`\`\`json
{
  "action": "dom_interact",
  "domAction": "extract_page_content"
}
\`\`\`
To fill a form input semantically:
\`\`\`json
{
  "action": "dom_interact",
  "domAction": "fill",
  "text": "semantic label (e.g. Email Address, Search box)",
  "tag": "INPUT" | "TEXTAREA",
  "value": "text to type"
}
\`\`\`
To click a button/link:
\`\`\`json
{
  "action": "dom_interact",
  "domAction": "click",
  "text": "label of element",
  "tag": "BUTTON" | "A" | "DIV" | "SPAN"
}
\`\`\`
`;
    }

    let finalPrompt = userPrompt;

    // 2. Local Semantic Search / RAG Injection
    if (isRagEnabled && activeModel !== "gemini-nano") {
      try {
        console.log("Computing RAG search query embedding...");
        const queryEmbed = await new Promise<any>((resolve, reject) => {
          chrome.runtime.sendMessage({ type: "GET_EMBEDDING", text: userPrompt }, (response) => {
            if (response && response.success) resolve(response);
            else reject(new Error(response?.error || "Unknown embedding error."));
          });
        });

        if (queryEmbed && queryEmbed.vector) {
          const [similarMessages, similarDocChunks] = await Promise.all([
            LocalDb.searchSimilarMessages(queryEmbed.vector, 3),
            LocalDb.searchSimilarDocumentChunks(queryEmbed.vector, 4)
          ]);

          const matchingContexts = similarMessages.filter(m => m.sessionId !== sessionId);
          const matchingChunks = similarDocChunks.filter(c => c.similarity > 0.3);

          let contextString = "";
          if (matchingContexts.length > 0) {
            contextString += "--- MEMORY FROM PAST CONVERSATIONS ---\n" + 
              matchingContexts.map(m => `[Past Chat]: ${m.text}`).join("\n") + "\n\n";
          }
          if (matchingChunks.length > 0) {
            contextString += "--- SEMANTIC CONTEXT FROM UPLOADED DOCUMENTS ---\n" +
              matchingChunks.map(c => `[Doc: ${c.documentName} (Page ${c.pageNumber})]: ${c.text}`).join("\n") + "\n\n";
          }

          if (contextString) {
            console.log(`Found RAG context. Injecting to query...`);
            finalPrompt = `Below is the relevant context retrieved from semantic memory and documents:\n\n${contextString}Use the context above to help answer the following query.\n\nUser Query: ${userPrompt}`;
          }
        }
      } catch (err) {
        console.warn("Local RAG context retrieval failed:", err);
      }
    }

    // Prepend system instructions to the final prompt
    finalPrompt = `${systemInstructions}\n\nInput query: ${finalPrompt}`;

    // 3. Model Routing
    if (activeModel === "gemini-nano") {
      try {
        // @ts-ignore
        if (typeof ai === "undefined" || !ai.languageModel) {
          throw new Error("Gemini Nano not enabled. Enable Chrome flags: chrome://flags/#prompt-api-for-gemini-nano");
        }
        // @ts-ignore
        const session = await ai.languageModel.create();
        
        let nanoPrompt = finalPrompt;
        if (imageAttachment) {
          nanoPrompt = `[User uploaded cropped image screenshot (local OCR was bypassed because Gemini Nano is text-only. Try a cloud model to analyze screenshot details)]\n\n${nanoPrompt}`;
        }

        // @ts-ignore
        const stream = session.promptStreaming(nanoPrompt);
        
        let hasChunks = false;
        let finalResponseText = "";
        for await (const chunk of stream) {
          if (!hasChunks) {
            setMessages(prev => prev.map(msg => msg.id === aiMsgId ? { ...msg, text: "" } : msg));
            hasChunks = true;
          }
          finalResponseText = chunk;
          setMessages(prev => prev.map(msg => 
            msg.id === aiMsgId 
              ? { ...msg, text: chunk }
              : msg
          ));
        }

        // Save final Gemini Nano message in DB
        const saved = await LocalDb.addMessage(sessionId, "assistant", finalResponseText, undefined, undefined, currentSearchSourcesRef.current);
        const afterNanoMsgs = (updatedMessagesList || messages).map(m => m.id === aiMsgId ? saved : m);
        setMessages(afterNanoMsgs);
        
        // Execute potential agent loops with up-to-date history
        handleAgentAction(saved.text, afterNanoMsgs, sessionId);

        triggerLocalEmbedding(saved.id, saved.text).then(() => {
          if (enableCloudSync) CloudSync.sync().catch(console.error);
        });

        setIsGenerating(false);
        streamingIdRef.current = null;
      } catch (err: any) {
        setMessages(prev => prev.map(msg => 
          msg.id === aiMsgId 
            ? { ...msg, text: `⚠️ Local AI Error: Gemini Nano is not enabled in your browser.\n\nTo continue, please select a Cloud Engine (such as OpenAI, Claude, or Groq) in the selector at the bottom left, or enable local AI by visiting Settings (gear icon) and following the setup guide.` } 
            : msg
        ));
        setIsGenerating(false);
        streamingIdRef.current = null;
      }
    } 
    // Cloud API Execution
    else {
      setMessages(prev => prev.map(msg => msg.id === aiMsgId ? { ...msg, text: "" } : msg));

      // Pass correct message history — use updatedMessagesList if provided (recursive tool call loop)
      const historyForStream = (updatedMessagesList || messages).filter(m => m.id !== aiMsgId);
      
      chrome.runtime.sendMessage({
        type: "GENERATE_STREAM",
        prompt: finalPrompt,
        history: historyForStream,
        model: activeModel,
        keys: apiKeys,
        image: imageAttachment
      }).catch(err => {
        setMessages(prev => prev.map(msg => 
          msg.id === aiMsgId 
            ? { ...msg, text: `Orchestrator Connection Error: ${err.message}` } 
            : msg
        ));
        setIsGenerating(false);
        streamingIdRef.current = null;
      });
    }
  };

  const handleCancelGeneration = () => {
    chrome.runtime.sendMessage({ type: "ABORT_STREAM" }).catch(console.error);
    setIsGenerating(false);
    streamingIdRef.current = null;
  };

  const handleSend = async () => {
    if ((!input.trim() && !screenshotAttachment) || !activeSession) return;

    const userPrompt = input;
    const currentAttachment = screenshotAttachment;
    setInput("");
    setScreenshotAttachment(null);

    let searchSources: any[] = [];
    let finalPromptToModel = userPrompt;

    let pageContextString = "";
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs[0];
      if (tab && tab.id && tab.url && !tab.url.startsWith("chrome://") && !tab.url.startsWith("chrome-extension://") && !tab.url.startsWith("edge://") && !tab.url.startsWith("about:")) {
        const scrapeRes = await new Promise<any>((resolve) => {
          const timeout = setTimeout(() => resolve(null), 300);
          chrome.tabs.sendMessage(tab.id!, { type: "EXTRACT_PAGE_CONTENT" }, (res) => {
            clearTimeout(timeout);
            resolve(res);
          });
        });
        if (scrapeRes && scrapeRes.success && scrapeRes.text) {
          pageContextString = `\n\n[Active Tab Webpage Context]\nURL: ${tab.url}\nTitle: ${scrapeRes.title || tab.title}\nContent:\n${scrapeRes.text.slice(0, 3000)}`;
        }
      }
    } catch (e) {
      console.warn("Auto context grounding failed:", e);
    }

    if (!youtubeVideoId && pageContextString && !isWebSearchEnabled) {
      finalPromptToModel = `${pageContextString}\n\nUser Query: ${finalPromptToModel}`;
    }

    if (isWebSearchEnabled && userPrompt.trim()) {
      setIsWebSearchLoading(true);
      try {
        console.log("Triggering Web Search grounding...");
        const searchResponse = await new Promise<any>((resolve) => {
          chrome.runtime.sendMessage({ type: "PERFORM_WEB_SEARCH", query: userPrompt }, (res) => {
            resolve(res);
          });
        });

        if (searchResponse && searchResponse.success) {
          const results = searchResponse.results || [];
          const pages = searchResponse.pages || [];
          
          searchSources = results.map((r: any) => ({
            title: r.title,
            url: r.url,
            snippet: r.snippet
          }));

          if (results.length > 0) {
            const sourcesContext = results.map((r: any, i: number) => {
              const pageContent = pages.find((p: any) => p.url === r.url)?.content || "";
              return `[Source ${i+1}]: ${r.title}\nURL: ${r.url}\nSummary: ${r.snippet}\nFull Page content excerpt: ${pageContent.slice(0, 1500)}`;
            }).join("\n\n");

            finalPromptToModel = `Use the following search results to answer the query. Cite sources using [1], [2], etc. where appropriate.

Search results:
${sourcesContext}

User Query: ${userPrompt}`;
          }
        }
      } catch (e) {
        console.warn("Search grounding failed, falling back to original query:", e);
      } finally {
        setIsWebSearchLoading(false);
      }
    }

    const userMsg = await LocalDb.addMessage(
      activeSession.id, 
      "user", 
      userPrompt || "Analyze this screenshot", 
      undefined, 
      currentAttachment || undefined
    );
    const latestMessages = [...messages, userMsg];
    setMessages(latestMessages);
    
    if (userPrompt.trim()) {
      triggerLocalEmbedding(userMsg.id, userPrompt).then(() => {
        if (enableCloudSync) CloudSync.sync().catch(console.error);
      });
    }

    agentLoopCountRef.current = 0;

    executeModelStream(
      finalPromptToModel || "Explain this screenshot.", 
      activeSession.id, 
      latestMessages, 
      currentAttachment || undefined, 
      searchSources
    );
  };

  const handleSuggestedClick = async (question: string) => {
    if (!activeSession) return;
    setInput("");
    
    let pageContextString = "";
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs[0];
      if (tab && tab.id && tab.url && !tab.url.startsWith("chrome://") && !tab.url.startsWith("chrome-extension://") && !tab.url.startsWith("edge://") && !tab.url.startsWith("about:")) {
        const scrapeRes = await new Promise<any>((resolve) => {
          const timeout = setTimeout(() => resolve(null), 300);
          chrome.tabs.sendMessage(tab.id!, { type: "EXTRACT_PAGE_CONTENT" }, (res) => {
            clearTimeout(timeout);
            resolve(res);
          });
        });
        if (scrapeRes && scrapeRes.success && scrapeRes.text) {
          pageContextString = `\n\n[Active Tab Webpage Context]\nURL: ${tab.url}\nTitle: ${scrapeRes.title || tab.title}\nContent:\n${scrapeRes.text.slice(0, 3000)}`;
        }
      }
    } catch (e) {
      console.warn("Auto context grounding failed on suggested click:", e);
    }

    let finalPromptToModel = question;
    if (!youtubeVideoId && pageContextString) {
      finalPromptToModel = `${pageContextString}\n\nUser Query: ${finalPromptToModel}`;
    }

    const userMsg = await LocalDb.addMessage(activeSession.id, "user", question);
    const latestMessages = [...messages, userMsg];
    setMessages(latestMessages);

    if (question.trim()) {
      triggerLocalEmbedding(userMsg.id, question).then(() => {
        if (enableCloudSync) CloudSync.sync().catch(console.error);
      });
    }

    agentLoopCountRef.current = 0;
    executeModelStream(finalPromptToModel, activeSession.id, latestMessages);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const modelLabels: { [key: string]: string } = {
    "gemini-nano": "Gemini Nano",
    "groq": "Groq Cloud",
    "openrouter": "OpenRouter",
    "openai": "OpenAI Client",
    "deepseek": "DeepSeek AI",
    "claude": "Claude Anthropic",
    "mistral": "Mistral API",
    "custom": "Custom API"
  };

  // Get active canvas background and drifting blob colors
  const activeCanvasClass = theme === "light" ? "bg-[#f4f5f8]" : bgPresets[bgPreset].canvas;
  const activeBlobColors = theme === "light" 
    ? ["bg-pink-400/20", "bg-blue-400/25", "bg-emerald-400/15"] 
    : bgPresets[bgPreset].blobs;

  const glassClass = theme === "light" ? "ios-glass-light text-zinc-900" : "ios-glass-dark text-white";
  const widgetClass = theme === "light" ? "ios-widget-light text-zinc-800 border-zinc-200" : "ios-widget-dark text-white border-white/5";
  const userBubbleClass = theme === "light" ? "ios-bubble-user-light text-white" : "ios-bubble-user-dark text-white";
  const inputBedClass = theme === "light" ? "ios-input-bed-light" : "ios-input-bed-dark";
  const textSecondaryClass = theme === "light" ? "text-zinc-500" : "text-zinc-300";
  const textTertiaryClass = theme === "light" ? "text-zinc-400" : "text-zinc-500";
  const settingsGroupClass = theme === "light" ? "ios-settings-group-light" : "ios-settings-group-dark";
  const settingsRowClass = theme === "light" ? "ios-settings-row-light" : "ios-settings-row-dark";

  return (
    <div className={`relative w-full h-screen flex flex-row overflow-hidden select-none transition-colors duration-300 ${activeCanvasClass}`}>
      
      {/* Drifting iOS background blobs */}
      <div className={`ios-blob ${activeBlobColors[0]} w-[280px] h-[280px] -top-12 -left-12`} />
      <div className={`ios-blob ${activeBlobColors[1]} w-[360px] h-[360px] top-1/3 -right-24`} style={{ animationDelay: "-5s" }} />
      <div className={`ios-blob ${activeBlobColors[2]} w-[260px] h-[260px] bottom-10 -left-10`} style={{ animationDelay: "-10s" }} />

      {/* LEFT COLUMN: Main Panel (Tab Content) */}
      <div className="relative flex-1 h-full flex flex-col z-10 overflow-hidden min-w-0">
        
        {/* 1. Header (iOS frosted glass element) */}
        <header className={`flex items-center justify-between px-4 py-3.5 border-b border-ios-border ${glassClass} select-none transition-colors duration-300`}>
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${isConnected ? "bg-emerald-500 animate-pulse" : "bg-zinc-400"}`} />
            <h1 className={`font-bold text-sm tracking-wide ${theme === 'light' ? 'text-zinc-900' : 'text-zinc-100'}`}>
              {activeTab === "chat" && "Visper Chat"}
              {activeTab === "write" && "AI Writer"}
              {activeTab === "translate" && "AI Translator"}
              {activeTab === "settings" && "Visper Settings"}
            </h1>
            {pageMcpContext?.available && (
              <span className="flex items-center px-1.5 py-0.5 rounded-full text-[8px] font-bold bg-indigo-500/20 text-indigo-500 border border-indigo-500/20 animate-pulse">
                WebMCP
              </span>
            )}
          </div>
          
          <div className="flex items-center gap-2">
            {/* Active Model Indicator Badge */}
            <div className={`flex flex-col items-end px-3 py-1 rounded-xl border ${
              activeModel === "gemini-nano" && !isLocalAiAvailable
                ? "border-red-500/30 bg-red-500/10 text-red-400 font-bold"
                : theme === 'light' 
                  ? 'border-zinc-200 bg-black/5 text-zinc-700' 
                  : 'border-white/5 bg-white/5 text-zinc-300'
            } select-none`}>
              <div className="flex items-center gap-1 text-[9px] font-bold">
                <Cpu size={10} />
                <span>
                  {modelLabels[activeModel]}
                  {activeModel === "gemini-nano" && !isLocalAiAvailable && " (Not Enabled)"}
                </span>
              </div>
            </div>

            {/* Crop Screen / Summarize Page Buttons (Only in Chat/Write) */}
            {(activeTab === "chat" || activeTab === "write") && (
              <div className="flex items-center gap-1.5">
                <button 
                  onClick={handleOcrCapture}
                  className={`p-1.5 rounded-full border border-transparent transition-all active:scale-95 flex items-center justify-center ${theme === 'light' ? 'text-zinc-500 hover:text-indigo-600 hover:bg-indigo-50' : 'text-zinc-400 hover:text-indigo-400 hover:bg-white/5'}`}
                  title="Crop & OCR screen selection"
                >
                  <Crop size={15} />
                </button>
                <button 
                  onClick={handleSummarizePage}
                  className={`p-1.5 rounded-full border border-transparent transition-all active:scale-95 flex items-center justify-center ${theme === 'light' ? 'text-zinc-500 hover:text-indigo-600 hover:bg-indigo-50' : 'text-zinc-400 hover:text-indigo-400 hover:bg-white/5'}`}
                  title="Summarize current page"
                >
                  <Sparkles size={15} />
                </button>
              </div>
            )}
          </div>
        </header>

        {/* 2. Content Render (Switched by activeTab) */}
        {activeTab === "chat" && (
          <>
            {/* Chat Log Scroll Area */}
            <main className="flex-1 overflow-y-auto px-4 py-4 space-y-4 scroll-smooth">
              {youtubeVideoId && (
                <div className={`p-3.5 border rounded-2xl flex flex-col gap-3 transition-colors duration-300 relative overflow-hidden ${
                  theme === 'light' 
                    ? 'bg-red-500/5 border-red-200 text-zinc-800' 
                    : 'bg-red-600/10 border-red-500/20 text-white'
                }`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={`h-6 w-6 rounded-lg flex items-center justify-center shrink-0 ${theme === 'light' ? 'bg-red-500/10 text-red-600' : 'bg-red-600/20 text-red-400'}`}>
                        <Play size={13} />
                      </div>
                      <div className="text-[11px] font-bold tracking-wide truncate max-w-[170px]" title={youtubeTitle}>
                        {youtubeTitle || "YouTube Video Detected"}
                      </div>
                    </div>
                    <button
                      onClick={() => setIsYoutubeHelperOpen(!isYoutubeHelperOpen)}
                      className={`text-[9px] px-2 py-0.5 rounded border transition-colors ${
                        theme === 'light'
                          ? 'border-zinc-200 hover:bg-zinc-100 text-zinc-600'
                          : 'border-white/10 hover:bg-white/5 text-zinc-300'
                      }`}
                    >
                      {isYoutubeHelperOpen ? "Hide" : "Open Helper"}
                    </button>
                  </div>

                  {isYoutubeHelperOpen && (
                    <div className="flex flex-col gap-2 pt-2 border-t border-red-500/10 text-xs">
                      <div className="flex gap-2">
                        {youtubeTranscript && (
                          <button
                            onClick={handleSummarizeYoutubeVideo}
                            disabled={isGenerating}
                            className={`flex-1 py-1.5 px-3 rounded-lg text-[10px] font-bold flex items-center justify-center gap-1 transition-all active:scale-95 ${
                              theme === 'light'
                                ? 'bg-red-600 hover:bg-red-700 text-white'
                                : 'bg-red-500/25 border border-red-500/35 hover:bg-red-500/40 text-red-100'
                            }`}
                          >
                            <Sparkles size={11} />
                            <span>Summarize Video</span>
                          </button>
                        )}
                        {!youtubeTranscript && (
                          <button
                            onClick={handleSummarizeYoutubeVideo}
                            disabled={isGenerating}
                            className={`flex-1 py-1.5 px-3 rounded-lg text-[10px] font-bold flex items-center justify-center gap-1 transition-all active:scale-95 ${
                              theme === 'light'
                                ? 'bg-red-600 hover:bg-red-700 text-white'
                                : 'bg-red-500/25 border border-red-500/35 hover:bg-red-500/40 text-red-100'
                            }`}
                          >
                            <Sparkles size={11} />
                            <span>Summarize Description</span>
                          </button>
                        )}
                      </div>

                      {youtubeTranscript && (
                        <div className="flex flex-col gap-1.5 mt-1.5">
                          <div className={`text-[9px] font-bold uppercase tracking-wider ${theme === 'light' ? 'text-zinc-400' : 'text-zinc-500'}`}>
                            Interactive Transcript (Click to seek)
                          </div>
                          <div className="max-h-[140px] overflow-y-auto space-y-1 pr-1 border border-black/5 rounded-lg p-1.5 bg-black/10">
                            {youtubeTranscript.slice(0, 100).map((line, idx) => (
                              <div key={idx} className="flex items-start gap-2 text-[10px] leading-relaxed group">
                                <button
                                  onClick={() => handleYoutubeSeek(line.start)}
                                  className={`font-semibold px-1 rounded hover:bg-indigo-500/20 hover:text-indigo-400 transition-colors ${
                                    theme === 'light' ? 'text-red-600' : 'text-red-400'
                                  }`}
                                >
                                  {formatTime(line.start)}
                                </button>
                                <span className={theme === 'light' ? 'text-zinc-600' : 'text-zinc-300'}>
                                  {line.text}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
              {messages.map((msg) => (
                <div 
                  key={msg.id} 
                  className={`flex flex-col ${msg.sender === "user" ? "items-end" : "items-start"} w-full`}
                >
                  {msg.sender === "user" ? (
                    <div className="max-w-[85%] flex flex-col items-end gap-1.5">
                      {msg.image && (
                        <div className="rounded-xl overflow-hidden border border-white/10 max-w-[200px] shadow-lg">
                          <img src={msg.image} alt="User cropped selection" className="w-full h-auto max-h-[160px] object-contain" />
                        </div>
                      )}
                      {msg.text && (
                        <div className={`px-4 py-2.5 text-sm break-words leading-relaxed select-text ${userBubbleClass}`}>
                          {msg.text}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className={`max-w-[90%] p-3.5 flex flex-col gap-2.5 border select-text transition-colors duration-300 ${widgetClass}`}>
                      {(() => {
                        const { cleanText, questions } = parseSuggestedQuestions(msg.text);
                        return (
                          <>
                            <div className="flex gap-3 items-start w-full">
                              <div className={`h-6 w-6 rounded-lg flex items-center justify-center shrink-0 ${theme === 'light' ? 'bg-indigo-500/10 border border-indigo-400/20 text-indigo-600' : 'bg-indigo-600/15 border border-indigo-500/20 text-indigo-400'}`}>
                                <CloudLightning size={13} />
                              </div>
                              <div className={`flex-1 min-w-0 text-sm leading-relaxed select-text ${theme === 'light' ? 'text-zinc-800' : 'text-zinc-200'}`}>
                                <MarkdownRenderer text={cleanText || "Loading..."} theme={theme} />
                              </div>
                            </div>

                            {msg.sources && msg.sources.length > 0 && (
                              <div className="border-t border-white/5 pt-2 mt-1">
                                <div className={`text-[10px] font-bold mb-1.5 ${theme === 'light' ? 'text-zinc-500' : 'text-zinc-400'} flex items-center gap-1`}>
                                  <Search size={10} />
                                  <span>Sources Cited:</span>
                                </div>
                                <div className="flex flex-wrap gap-1.5 max-h-[80px] overflow-y-auto pr-1">
                                  {msg.sources.map((src: any, sIdx: number) => (
                                    <a
                                      key={sIdx}
                                      href={src.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className={`text-[10px] px-2 py-0.5 rounded-md border flex items-center gap-1 transition-colors ${
                                        theme === 'light'
                                          ? 'bg-zinc-50 border-zinc-200 text-zinc-600 hover:bg-zinc-100 hover:text-indigo-600'
                                          : 'bg-white/5 border-white/5 text-zinc-300 hover:bg-white/10 hover:text-indigo-400'
                                      }`}
                                      title={src.snippet || src.title}
                                    >
                                      <span className="font-bold text-[9px] bg-black/10 px-1 py-0.2 rounded text-zinc-500">{sIdx + 1}</span>
                                      <span className="truncate max-w-[120px]">{src.title}</span>
                                    </a>
                                  ))}
                                </div>
                              </div>
                            )}

                            {msg.ocrProvider && (
                              <div className="border-t border-white/5 pt-2 mt-1">
                                <div className={`text-[10px] flex items-center gap-1.5 ${theme === 'light' ? 'text-zinc-500' : 'text-zinc-400'}`}>
                                  <ImageIcon size={10} className="text-indigo-400 shrink-0" />
                                  <span>Image analyzed via <span className="font-semibold text-indigo-400">{msg.ocrProvider}</span></span>
                                </div>
                              </div>
                            )}

                            {questions.length > 0 && !isGenerating && (
                              <div className="flex flex-col gap-1.5 border-t border-white/5 pt-2 mt-1 relative">
                                <div className={`text-[9px] font-bold uppercase tracking-wider ${theme === 'light' ? 'text-zinc-400' : 'text-zinc-500'}`}>
                                  Suggested Follow-ups
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  {questions.map((q: string, qIdx: number) => (
                                    <button
                                      key={qIdx}
                                      onClick={() => handleSuggestedClick(q)}
                                      className={`text-[10px] text-left px-2.5 py-1.2 rounded-lg border transition-all active:scale-[0.98] ${
                                        theme === 'light'
                                          ? 'bg-indigo-50 border-indigo-100 hover:bg-indigo-100 hover:border-indigo-200 text-indigo-600'
                                          : 'bg-indigo-500/10 border-indigo-500/15 hover:bg-indigo-500/15 hover:border-indigo-500/25 text-indigo-300'
                                      }`}
                                    >
                                      {q}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  )}
                  <span className={`text-[9px] mt-1 px-2 select-none ${textTertiaryClass}`}>
                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ))}
              <div ref={chatEndRef} />
            </main>

            {/* Input Console */}
            <footer className={`p-4 border-t border-ios-border ${glassClass} bg-opacity-65 transition-colors duration-300`}>
              <div className={`${inputBedClass} p-2.5 flex flex-col gap-2 relative transition-colors duration-300`}>
                {screenshotAttachment && (
                  <div className="relative inline-block w-16 h-16 rounded-lg overflow-hidden border border-white/10 group mb-1 shrink-0">
                    <img src={screenshotAttachment} alt="Screenshot crop" className="w-full h-full object-cover" />
                    <button 
                      onClick={() => setScreenshotAttachment(null)}
                      className="absolute top-1 right-1 bg-black/70 hover:bg-black/90 p-0.5 rounded-full text-white transition-colors"
                    >
                      <X size={10} />
                    </button>
                  </div>
                )}
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={screenshotAttachment ? "Ask about this screenshot crop..." : "Ask Visper anything..."}
                  className={`w-full bg-transparent border-0 outline-none resize-none text-xs placeholder-zinc-500 max-h-24 min-h-[40px] focus:ring-0 leading-relaxed ${theme === 'light' ? 'text-zinc-800' : 'text-white'}`}
                  rows={1}
                />
                
                <div className="flex items-center justify-between border-t border-white/5 pt-2 mt-1 relative">
                  <div className="flex items-center gap-2" ref={dropdownRef}>
                    <button
                      onClick={() => setIsModelDropdownOpen(!isModelDropdownOpen)}
                      className={`flex items-center gap-1.5 border rounded-lg px-2.5 py-1 text-[10px] font-semibold transition-all active:scale-95 ${theme === 'light' ? 'bg-black/5 hover:bg-black/10 border-zinc-200 text-zinc-700 hover:text-zinc-900' : 'bg-white/5 hover:bg-white/10 border-white/5 text-zinc-300 hover:text-white'}`}
                    >
                      <span>{modelLabels[activeModel]}</span>
                      <ChevronUp size={10} className={`text-zinc-400 transition-transform duration-200 ${isModelDropdownOpen ? "rotate-180" : ""}`} />
                    </button>

                    <button
                      onClick={() => setIsWebSearchEnabled(!isWebSearchEnabled)}
                      className={`flex items-center gap-1 border rounded-lg px-2.5 py-1 text-[10px] font-semibold transition-all active:scale-95 ${
                        isWebSearchEnabled 
                          ? theme === 'light' 
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-600' 
                            : 'bg-[#10b981]/15 border-[#10b981]/25 text-[#10b981]'
                          : theme === 'light'
                            ? 'bg-black/5 border-zinc-200 text-zinc-500 hover:text-zinc-700'
                            : 'bg-white/5 border-white/5 text-zinc-400 hover:text-zinc-200'
                      }`}
                      title="Toggle Deep Web Search"
                    >
                      <Search size={10} />
                      <span>Search</span>
                    </button>
                    {isWebSearchLoading && <Loader2 size={10} className="animate-spin text-[#10b981]" />}

                    {isModelDropdownOpen && (
                      <div className={`absolute bottom-full left-0 mb-2 w-52 max-h-60 overflow-y-auto rounded-2xl border p-1.5 shadow-2xl z-30 animate-fade-in flex flex-col gap-1 ${theme === 'light' ? 'bg-white/95 border-zinc-200' : 'bg-[#0f0b21]/95 border-white/10 backdrop-blur-xl'}`}>
                        <div className={`text-[9px] font-bold px-2.5 py-1 uppercase tracking-wider ${textTertiaryClass}`}>Select Engine</div>
                        {Object.keys(modelLabels).map((key) => (
                          <button
                            key={key}
                            onClick={() => {
                              setActiveModel(key);
                              setIsModelDropdownOpen(false);
                              saveSettings(apiKeys, theme, bgPreset, enableCloudSync, isRagEnabled, key, fetchedModels);
                            }}
                            className={`flex items-center justify-between w-full px-2.5 py-1.5 text-[11px] rounded-lg text-left transition-colors ${
                              activeModel === key 
                                ? theme === 'light' 
                                  ? "bg-indigo-50 text-indigo-600 border border-indigo-100"
                                  : "bg-indigo-600/20 text-indigo-300 border border-indigo-500/10" 
                                : theme === 'light'
                                  ? "text-zinc-700 hover:bg-zinc-100"
                                  : "text-zinc-300 hover:bg-white/5"
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <span>{modelLabels[key]}</span>
                              {key === "gemini-nano" && (
                                isLocalAiAvailable ? (
                                  <span className="text-[8px] bg-emerald-500/15 text-emerald-400 px-1 py-0.5 rounded font-bold uppercase">Ready</span>
                                ) : (
                                  <span className="text-[8px] bg-amber-500/15 text-amber-500 px-1 py-0.5 rounded font-bold uppercase">Setup Needed</span>
                                )
                              )}
                            </div>
                            {activeModel === key && <Check size={11} className={theme === 'light' ? 'text-indigo-600' : 'text-indigo-400'} />}
                          </button>
                        ))}
                      </div>
                    )}
                    
                    <span className={`text-[9px] select-none ${textTertiaryClass}`}>
                      {input.length} chars
                    </span>
                  </div>

                  {isGenerating ? (
                    <button
                      onClick={handleCancelGeneration}
                      className="p-1.5 rounded-lg flex items-center justify-center transition-all bg-rose-600 hover:bg-rose-500 text-white shadow-md shadow-rose-600/20 active:scale-95 animate-pulse"
                      title="Stop Generating"
                    >
                      <div className="w-3 h-3 bg-white rounded-[2px]" />
                    </button>
                  ) : (
                    <button
                      onClick={handleSend}
                      disabled={!input.trim()}
                      className={`p-1.5 rounded-lg flex items-center justify-center transition-all ${
                        input.trim() 
                          ? "bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/20 active:scale-95" 
                          : "text-zinc-500 cursor-not-allowed"
                      }`}
                    >
                      <Send size={13} />
                    </button>
                  )}
                </div>
              </div>
            </footer>
          </>
        )}

        {activeTab === "write" && (
          <main className="flex-1 overflow-y-auto p-4 space-y-4">
            <div className={`p-4 rounded-2xl border ${theme === 'light' ? 'bg-white border-zinc-200' : 'bg-white/5 border-white/5'} space-y-4`}>
              <div className="space-y-1.5">
                <label className={`text-[10px] font-bold uppercase tracking-wider ${textTertiaryClass}`}>What do you want to write about?</label>
                <textarea
                  value={writeTopic}
                  onChange={(e) => setWriteTopic(e.target.value)}
                  placeholder="E.g. A polite email asking for project extension, or a paragraph introducing a clothing brand..."
                  className={`w-full p-3 rounded-xl border text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 min-h-[70px] ${theme === 'light' ? 'bg-zinc-50 border-zinc-200 text-zinc-800' : 'bg-black/20 border-white/10 text-white'}`}
                />
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="space-y-1.5">
                  <label className={`text-[10px] font-bold uppercase tracking-wider ${textTertiaryClass}`}>Format</label>
                  <select
                    value={writeFormat}
                    onChange={(e) => setWriteFormat(e.target.value)}
                    className={`w-full p-2.5 rounded-xl border ${theme === 'light' ? 'bg-zinc-50 border-zinc-200 text-zinc-800' : 'bg-black/10 border-white/10 text-white'}`}
                  >
                    <option value="Paragraph" className={theme === 'light' ? 'text-zinc-800' : 'text-zinc-200 bg-[#0f0b21]'}>Paragraph</option>
                    <option value="Email" className={theme === 'light' ? 'text-zinc-800' : 'text-zinc-200 bg-[#0f0b21]'}>Email</option>
                    <option value="Outline" className={theme === 'light' ? 'text-zinc-800' : 'text-zinc-200 bg-[#0f0b21]'}>Outline</option>
                    <option value="Blog Post" className={theme === 'light' ? 'text-zinc-800' : 'text-zinc-200 bg-[#0f0b21]'}>Blog Post</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className={`text-[10px] font-bold uppercase tracking-wider ${textTertiaryClass}`}>Tone</label>
                  <select
                    value={writeTone}
                    onChange={(e) => setWriteTone(e.target.value)}
                    className={`w-full p-2.5 rounded-xl border ${theme === 'light' ? 'bg-zinc-50 border-zinc-200 text-zinc-800' : 'bg-black/10 border-white/10 text-white'}`}
                  >
                    <option value="Professional" className={theme === 'light' ? 'text-zinc-800' : 'text-zinc-200 bg-[#0f0b21]'}>Professional</option>
                    <option value="Casual" className={theme === 'light' ? 'text-zinc-800' : 'text-zinc-200 bg-[#0f0b21]'}>Casual</option>
                    <option value="Friendly" className={theme === 'light' ? 'text-zinc-800' : 'text-zinc-200 bg-[#0f0b21]'}>Friendly</option>
                    <option value="Direct" className={theme === 'light' ? 'text-zinc-800' : 'text-zinc-200 bg-[#0f0b21]'}>Direct</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className={`text-[10px] font-bold uppercase tracking-wider ${textTertiaryClass}`}>Length</label>
                <div className="flex gap-2">
                  {["Short", "Medium", "Long"].map(l => (
                    <button
                      key={l}
                      onClick={() => setWriteLength(l)}
                      className={`flex-1 py-2 rounded-xl text-xs font-semibold border transition-all ${
                        writeLength === l
                          ? "bg-indigo-600 text-white border-indigo-600"
                          : theme === 'light'
                            ? "bg-zinc-50 border-zinc-200 text-zinc-700 hover:bg-zinc-100"
                            : "bg-white/5 border-white/5 text-zinc-300 hover:bg-white/10"
                      }`}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={handleWriteGenerate}
                disabled={isWriting || !writeTopic.trim()}
                className={`w-full py-2.5 rounded-xl font-bold text-xs transition-all ${
                  isWriting || !writeTopic.trim()
                    ? "bg-zinc-700 text-zinc-500 cursor-not-allowed"
                    : "bg-indigo-600 hover:bg-indigo-500 text-white active:scale-95 shadow-lg shadow-indigo-600/20"
                }`}
              >
                {isWriting ? "Generating..." : "Generate Draft"}
              </button>
            </div>

            {writeResult && (
              <div className={`p-4 rounded-2xl border space-y-3 ${theme === 'light' ? 'bg-zinc-50 border-zinc-200 text-zinc-800' : 'bg-[#0c0818]/65 border-white/5 text-zinc-200'}`}>
                <div className="flex items-center justify-between">
                  <span className={`text-[10px] font-bold uppercase tracking-wider ${textTertiaryClass}`}>Generated Result</span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleInsertTextIntoPage(writeResult)}
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold border ${theme === 'light' ? 'bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100' : 'bg-indigo-600/20 border-indigo-500/20 text-indigo-300 hover:bg-indigo-600/35'}`}
                      title="Insert directly into the currently focused webpage textbox"
                    >
                      Insert into Page
                    </button>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(writeResult);
                        alert("Copied to clipboard!");
                      }}
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold border ${theme === 'light' ? 'bg-zinc-100 border-zinc-200 hover:bg-zinc-200 text-zinc-700' : 'bg-white/5 border-white/5 hover:bg-white/10 text-zinc-300'}`}
                    >
                      Copy
                    </button>
                  </div>
                </div>
                <div className="text-xs leading-relaxed whitespace-pre-wrap select-text max-h-64 overflow-y-auto pr-1">
                  {writeResult}
                </div>
              </div>
            )}
          </main>
        )}

        {activeTab === "translate" && (
          <main className="flex-1 overflow-y-auto p-4 space-y-4">
            <div className={`p-4 rounded-2xl border ${theme === 'light' ? 'bg-white border-zinc-200' : 'bg-white/5 border-white/5'} space-y-4`}>
              <div className="flex gap-3 items-center justify-between text-xs">
                <div className="flex-1 space-y-1.5">
                  <label className={`text-[10px] font-bold uppercase tracking-wider ${textTertiaryClass}`}>Source</label>
                  <select
                    value={translateSource}
                    onChange={(e) => setTranslateSource(e.target.value)}
                    className={`w-full p-2.5 rounded-xl border ${theme === 'light' ? 'bg-zinc-50 border-zinc-200 text-zinc-800' : 'bg-[#0f0b21] border-white/10 text-white'}`}
                  >
                    <option value="Auto Detect" className={theme === 'light' ? 'text-zinc-800' : 'text-zinc-200 bg-[#0f0b21]'}>Auto Detect</option>
                    <option value="English" className={theme === 'light' ? 'text-zinc-800' : 'text-zinc-200 bg-[#0f0b21]'}>English</option>
                    <option value="Urdu" className={theme === 'light' ? 'text-zinc-800' : 'text-zinc-200 bg-[#0f0b21]'}>Urdu</option>
                    <option value="Spanish" className={theme === 'light' ? 'text-zinc-800' : 'text-zinc-200 bg-[#0f0b21]'}>Spanish</option>
                    <option value="Portuguese" className={theme === 'light' ? 'text-zinc-800' : 'text-zinc-200 bg-[#0f0b21]'}>Portuguese</option>
                    <option value="French" className={theme === 'light' ? 'text-zinc-800' : 'text-zinc-200 bg-[#0f0b21]'}>French</option>
                    <option value="German" className={theme === 'light' ? 'text-zinc-800' : 'text-zinc-200 bg-[#0f0b21]'}>German</option>
                    <option value="Arabic" className={theme === 'light' ? 'text-zinc-800' : 'text-zinc-200 bg-[#0f0b21]'}>Arabic</option>
                    <option value="Chinese" className={theme === 'light' ? 'text-zinc-800' : 'text-zinc-200 bg-[#0f0b21]'}>Chinese</option>
                  </select>
                </div>
                
                <div className="flex-1 space-y-1.5">
                  <label className={`text-[10px] font-bold uppercase tracking-wider ${textTertiaryClass}`}>Target</label>
                  <select
                    value={translateTarget}
                    onChange={(e) => setTranslateTarget(e.target.value)}
                    className={`w-full p-2.5 rounded-xl border ${theme === 'light' ? 'bg-zinc-50 border-zinc-200 text-zinc-800' : 'bg-[#0f0b21] border-white/10 text-white'}`}
                  >
                    <option value="English" className={theme === 'light' ? 'text-zinc-800' : 'text-zinc-200 bg-[#0f0b21]'}>English</option>
                    <option value="Urdu" className={theme === 'light' ? 'text-zinc-800' : 'text-zinc-200 bg-[#0f0b21]'}>Urdu</option>
                    <option value="Spanish" className={theme === 'light' ? 'text-zinc-800' : 'text-zinc-200 bg-[#0f0b21]'}>Spanish</option>
                    <option value="Portuguese" className={theme === 'light' ? 'text-zinc-800' : 'text-zinc-200 bg-[#0f0b21]'}>Portuguese</option>
                    <option value="French" className={theme === 'light' ? 'text-zinc-800' : 'text-zinc-200 bg-[#0f0b21]'}>French</option>
                    <option value="German" className={theme === 'light' ? 'text-zinc-800' : 'text-zinc-200 bg-[#0f0b21]'}>German</option>
                    <option value="Arabic" className={theme === 'light' ? 'text-zinc-800' : 'text-zinc-200 bg-[#0f0b21]'}>Arabic</option>
                    <option value="Chinese" className={theme === 'light' ? 'text-zinc-800' : 'text-zinc-200 bg-[#0f0b21]'}>Chinese</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className={`text-[10px] font-bold uppercase tracking-wider ${textTertiaryClass}`}>Text to Translate</label>
                <textarea
                  value={translateText}
                  onChange={(e) => setTranslateText(e.target.value)}
                  placeholder="Enter text to translate..."
                  className={`w-full p-3 rounded-xl border text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 min-h-[70px] ${theme === 'light' ? 'bg-zinc-50 border-zinc-200 text-zinc-800' : 'bg-black/20 border-white/10 text-white'}`}
                />
              </div>

              <div className="flex gap-2">
                <button
                  onClick={handleTranslate}
                  disabled={isTranslating || !translateText.trim()}
                  className={`flex-1 py-2.5 rounded-xl font-bold text-xs transition-all ${
                    isTranslating || !translateText.trim()
                      ? "bg-zinc-700 text-zinc-500 cursor-not-allowed"
                      : "bg-indigo-600 hover:bg-indigo-500 text-white active:scale-95 shadow-lg shadow-indigo-600/20"
                  }`}
                >
                  {isTranslating ? "Translating..." : "Translate Text"}
                </button>

                <button
                  onClick={handleTranslatePage}
                  disabled={isTranslating}
                  className={`py-2.5 px-4 rounded-xl font-bold text-xs border transition-all flex items-center justify-center gap-1.5 ${
                    theme === 'light'
                      ? "bg-zinc-50 border-zinc-200 text-zinc-700 hover:bg-zinc-100"
                      : "bg-white/5 border-white/5 text-zinc-300 hover:bg-white/10"
                  }`}
                  title="Translate visible contents of the active webpage"
                >
                  <Sparkles size={12} />
                  <span>Translate Page</span>
                </button>
              </div>
            </div>

            {translateResult && (
              <div className={`p-4 rounded-2xl border space-y-3 ${theme === 'light' ? 'bg-zinc-50 border-zinc-200 text-zinc-800' : 'bg-[#0c0818]/65 border-white/5 text-zinc-200'}`}>
                <div className="flex items-center justify-between">
                  <span className={`text-[10px] font-bold uppercase tracking-wider ${textTertiaryClass}`}>Translation Result</span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleInsertTextIntoPage(translateResult)}
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold border ${theme === 'light' ? 'bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100' : 'bg-indigo-600/20 border-indigo-500/20 text-indigo-300 hover:bg-indigo-600/35'}`}
                    >
                      Insert into Page
                    </button>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(translateResult);
                        alert("Copied to clipboard!");
                      }}
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold border ${theme === 'light' ? 'bg-zinc-100 border-zinc-200 hover:bg-zinc-200 text-zinc-700' : 'bg-white/5 border-white/5 hover:bg-white/10 text-zinc-300'}`}
                    >
                      Copy
                    </button>
                  </div>
                </div>
                <div className="text-xs leading-relaxed whitespace-pre-wrap select-text max-h-64 overflow-y-auto pr-1 font-sans">
                  {translateResult}
                </div>
              </div>
            )}
          </main>
        )}

        {activeTab === "settings" && (
          <main className="flex-1 overflow-y-auto p-4 space-y-6">
            
            {/* Conversations Management */}
            <div className="space-y-2">
              <div className="flex items-center justify-between px-1">
                <h3 className={`text-[11px] font-semibold uppercase tracking-normal ${theme === 'light' ? 'text-zinc-500' : 'text-zinc-400'}`}>Conversations</h3>
                <button 
                  onClick={createNewChat}
                  className={`p-1 rounded-md border flex items-center justify-center transition-all ${theme === 'light' ? 'bg-black/5 border-zinc-200 text-zinc-700 hover:bg-zinc-100' : 'bg-white/5 border-white/5 text-zinc-300 hover:bg-white/10'}`}
                  title="Start new conversation"
                >
                  <Plus size={13} />
                </button>
              </div>

              <div className={`max-h-32 overflow-y-auto space-y-1.5 p-1.5 ${settingsGroupClass}`}>
                {sessions.map(s => (
                  <div
                    key={s.id}
                    onClick={() => loadSessions(s.id)}
                    className={`flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer text-xs transition-colors ${
                      activeSession?.id === s.id
                        ? theme === 'light'
                          ? "bg-indigo-50 border border-indigo-100 text-indigo-700 font-medium"
                          : "bg-indigo-600/20 border border-indigo-500/10 text-indigo-300 font-medium"
                        : theme === 'light'
                          ? "hover:bg-zinc-100 text-zinc-700"
                          : "hover:bg-white/5 text-zinc-300"
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <MessageSquare size={12} className="shrink-0 text-zinc-400" />
                      <span className="truncate">{s.title}</span>
                    </div>
                    {sessions.length > 1 && (
                      <button
                        onClick={(e) => deleteChat(s.id, e)}
                        className="p-1 rounded text-zinc-500 hover:text-rose-500 hover:bg-rose-500/10 transition-colors"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* General theme preset selection */}
            <div className="space-y-2">
              <h3 className={`text-[11px] font-semibold uppercase tracking-normal px-1 ${theme === 'light' ? 'text-zinc-500' : 'text-zinc-400'}`}>Visual presets</h3>
              <div className={`grid grid-cols-2 gap-2 p-3 ${settingsGroupClass}`}>
                {Object.keys(bgPresets).map(presetKey => (
                  <button
                    key={presetKey}
                    onClick={() => {
                      setBgPreset(presetKey as BgPresetKey);
                      saveSettings(apiKeys, theme, presetKey as BgPresetKey, enableCloudSync, isRagEnabled, activeModel, fetchedModels);
                    }}
                    className={`px-2.5 py-1.5 rounded-lg text-[10px] font-bold border transition-colors ${
                      bgPreset === presetKey
                        ? "bg-indigo-600 border-indigo-600 text-white"
                        : theme === 'light'
                          ? "bg-zinc-50 border-zinc-200 text-zinc-700 hover:bg-zinc-100"
                          : "bg-white/5 border-white/5 text-zinc-300 hover:bg-white/10"
                    }`}
                  >
                    {bgPresets[presetKey as BgPresetKey].name}
                  </button>
                ))}
              </div>
            </div>

            {/* Local Vector Search (RAG) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between px-1">
                <h3 className={`text-[11px] font-semibold uppercase tracking-normal ${theme === 'light' ? 'text-zinc-500' : 'text-zinc-400'}`}>Local Vector Search (RAG)</h3>
                
                <div 
                  onClick={() => {
                    const nextRag = !isRagEnabled;
                    setIsRagEnabled(nextRag);
                    saveSettings(apiKeys, theme, bgPreset, enableCloudSync, nextRag, activeModel, fetchedModels);
                  }}
                  className={`ios-switch ${isRagEnabled ? "ios-switch-active" : "ios-switch-inactive"}`}
                >
                  <div 
                    className="ios-switch-knob"
                    style={{ transform: isRagEnabled ? "translateX(20px)" : "translateX(2px)" }}
                  />
                </div>
              </div>
              
              <div className={`p-3 rounded-2xl border flex gap-2.5 items-start ${theme === 'light' ? 'bg-black/5 border-black/5' : 'bg-white/5 border-white/5'}`}>
                <Info size={14} className="text-indigo-500 shrink-0 mt-0.5" />
                <div className={`flex-1 text-[11px] leading-relaxed ${textSecondaryClass}`}>
                  If active, the extension runs local vector embeddings (`Xenova/all-MiniLM-L6-v2`) via WASM to recall past conversations and inject relevant memory context.
                </div>
              </div>

              {/* Local PDF Knowledge Base */}
              {isRagEnabled && (
                <div className={`p-3 rounded-2xl border ${theme === 'light' ? 'bg-black/5 border-black/5' : 'bg-white/5 border-white/5'} space-y-3`}>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold uppercase tracking-normal">Local PDF Knowledge Base</span>
                    {isUploading && <Loader2 size={12} className="animate-spin text-indigo-500" />}
                  </div>

                  {/* Drag-and-drop zone */}
                  <label 
                    className={`flex flex-col items-center justify-center border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-colors ${
                      theme === 'light'
                        ? 'border-zinc-300 hover:bg-zinc-100/50'
                        : 'border-zinc-700 hover:bg-white/5'
                    }`}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                        handleDocumentUpload(e.dataTransfer.files[0]);
                      }
                    }}
                  >
                    <Upload size={18} className="text-zinc-500 mb-1" />
                    <span className="text-[11px] font-medium text-zinc-400">Drag & drop PDF here, or click to upload</span>
                    <input 
                      type="file" 
                      accept=".pdf" 
                      className="hidden" 
                      onChange={(e) => {
                        if (e.target.files && e.target.files[0]) {
                          handleDocumentUpload(e.target.files[0]);
                        }
                      }}
                    />
                  </label>

                  {/* Documents list */}
                  {documents.length > 0 ? (
                    <div className="space-y-1.5 max-h-40 overflow-y-auto">
                      {documents.map((doc) => {
                        const progress = indexingProgress[doc.id] || 0;
                        return (
                          <div 
                            key={doc.id}
                            className={`flex items-center justify-between p-2 rounded-lg text-[11px] ${
                              theme === 'light' ? 'bg-zinc-100 text-zinc-700' : 'bg-white/5 text-zinc-300'
                            }`}
                          >
                            <div className="flex items-center gap-2 truncate">
                              <FileText size={14} className="text-indigo-400 shrink-0" />
                              <div className="truncate flex flex-col">
                                <span className="truncate font-medium">{doc.name}</span>
                                <span className="text-[9px] text-zinc-500">{(doc.size / 1024).toFixed(1)} KB</span>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              {doc.status === 'processing' && (
                                <div className="flex items-center gap-1">
                                  <Loader2 size={11} className="animate-spin text-indigo-500" />
                                  <span className="text-[9px] text-indigo-500 font-bold">{progress}%</span>
                                </div>
                              )}
                              {doc.status === 'ready' && (
                                <span title="Indexed successfully">
                                  <CheckCircle2 size={12} className="text-emerald-500" />
                                </span>
                              )}
                              {doc.status === 'error' && (
                                <span title={doc.error || "Indexing error"}>
                                  <AlertCircle size={12} className="text-rose-500" />
                                </span>
                              )}

                              <button
                                onClick={() => handleDocumentDelete(doc.id)}
                                className="p-1 rounded text-zinc-500 hover:text-rose-500 hover:bg-rose-500/10 transition-colors"
                              >
                                <X size={11} />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-center py-2 text-[10px] text-zinc-500">
                      No documents added yet. Drag and drop a PDF file to enable semantic vector retrieval.
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* API Credentials */}
            <div className="space-y-2 border-t border-white/5 pt-4">
              <h3 className={`text-[11px] font-semibold uppercase tracking-normal px-1 ${theme === 'light' ? 'text-zinc-500' : 'text-zinc-400'}`}>API Credentials</h3>
              
              <div className={settingsGroupClass}>
                
                {/* OpenAI Row */}
                <div className={settingsRowClass}>
                  <div className="flex items-center justify-between w-full h-9">
                    <div className="flex items-center gap-2.5">
                      <div className="ios-settings-icon-wrapper bg-green-600">
                        <Key size={14} />
                      </div>
                      <span className="text-[14px] font-normal">OpenAI Key</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="password"
                        value={apiKeys.openai}
                        onChange={(e) => {
                          const updated = { ...apiKeys, openai: e.target.value };
                          setApiKeys(updated);
                          saveSettings(updated, theme, bgPreset, enableCloudSync, isRagEnabled, activeModel, fetchedModels);
                        }}
                        placeholder="sk-..."
                        className={`text-right bg-transparent border-0 outline-none text-xs w-28 ${theme === 'light' ? 'text-zinc-800 placeholder-zinc-300' : 'text-zinc-100 placeholder-zinc-600'}`}
                      />
                      <button
                        onClick={() => fetchModels("openai", apiKeys.openai)}
                        className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase transition-all ${theme === 'light' ? 'bg-indigo-50 text-indigo-600' : 'bg-white/5 text-indigo-400 hover:bg-white/10'}`}
                      >
                        {loadingModels === "openai" ? "..." : "Load"}
                      </button>
                    </div>
                  </div>
                </div>
                {fetchedModels.openai.length > 0 && (
                  <div className={settingsRowClass}>
                    <div className="flex items-center justify-between w-full h-9 pl-9">
                      <span className="text-xs text-zinc-400">Select Model</span>
                      <select
                        value={apiKeys.openaiModel}
                        onChange={(e) => {
                          const updated = { ...apiKeys, openaiModel: e.target.value };
                          setApiKeys(updated);
                          saveSettings(updated, theme, bgPreset, enableCloudSync, isRagEnabled, activeModel, fetchedModels);
                        }}
                        className={`bg-transparent border-0 outline-none text-xs text-right max-w-[150px] ${theme === 'light' ? 'text-zinc-800' : 'text-zinc-100'}`}
                      >
                        {fetchedModels.openai.map(m => (
                          <option key={m} value={m} className={theme === 'light' ? 'text-zinc-800' : 'text-zinc-100 bg-[#0f0b21]'}>{m}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                {/* Claude Row */}
                <div className={settingsRowClass}>
                  <div className="flex items-center justify-between w-full h-9">
                    <div className="flex items-center gap-2.5">
                      <div className="ios-settings-icon-wrapper bg-orange-600">
                        <Key size={14} />
                      </div>
                      <span className="text-[14px] font-normal">Claude Key</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="password"
                        value={apiKeys.claude}
                        onChange={(e) => {
                          const updated = { ...apiKeys, claude: e.target.value };
                          setApiKeys(updated);
                          saveSettings(updated, theme, bgPreset, enableCloudSync, isRagEnabled, activeModel, fetchedModels);
                        }}
                        placeholder="sk-ant-..."
                        className={`text-right bg-transparent border-0 outline-none text-xs w-28 ${theme === 'light' ? 'text-zinc-800 placeholder-zinc-300' : 'text-zinc-100 placeholder-zinc-600'}`}
                      />
                      <button
                        onClick={() => fetchModels("claude", apiKeys.claude)}
                        className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase transition-all ${theme === 'light' ? 'bg-indigo-50 text-indigo-600' : 'bg-white/5 text-indigo-400 hover:bg-white/10'}`}
                      >
                        {loadingModels === "claude" ? "..." : "Load"}
                      </button>
                    </div>
                  </div>
                </div>
                {fetchedModels.claude.length > 0 && (
                  <div className={settingsRowClass}>
                    <div className="flex items-center justify-between w-full h-9 pl-9">
                      <span className="text-xs text-zinc-400">Select Model</span>
                      <select
                        value={apiKeys.claudeModel}
                        onChange={(e) => {
                          const updated = { ...apiKeys, claudeModel: e.target.value };
                          setApiKeys(updated);
                          saveSettings(updated, theme, bgPreset, enableCloudSync, isRagEnabled, activeModel, fetchedModels);
                        }}
                        className={`bg-transparent border-0 outline-none text-xs text-right max-w-[150px] ${theme === 'light' ? 'text-zinc-800' : 'text-zinc-100'}`}
                      >
                        {fetchedModels.claude.map(m => (
                          <option key={m} value={m} className={theme === 'light' ? 'text-zinc-800' : 'text-zinc-100 bg-[#0f0b21]'}>{m}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                {/* DeepSeek Row */}
                <div className={settingsRowClass}>
                  <div className="flex items-center justify-between w-full h-9">
                    <div className="flex items-center gap-2.5">
                      <div className="ios-settings-icon-wrapper bg-sky-600">
                        <Key size={14} />
                      </div>
                      <span className="text-[14px] font-normal">DeepSeek Key</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="password"
                        value={apiKeys.deepseek}
                        onChange={(e) => {
                          const updated = { ...apiKeys, deepseek: e.target.value };
                          setApiKeys(updated);
                          saveSettings(updated, theme, bgPreset, enableCloudSync, isRagEnabled, activeModel, fetchedModels);
                        }}
                        placeholder="sk-..."
                        className={`text-right bg-transparent border-0 outline-none text-xs w-28 ${theme === 'light' ? 'text-zinc-800 placeholder-zinc-300' : 'text-zinc-100 placeholder-zinc-600'}`}
                      />
                      <button
                        onClick={() => fetchModels("deepseek", apiKeys.deepseek)}
                        className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase transition-all ${theme === 'light' ? 'bg-indigo-50 text-indigo-600' : 'bg-white/5 text-indigo-400 hover:bg-white/10'}`}
                      >
                        {loadingModels === "deepseek" ? "..." : "Load"}
                      </button>
                    </div>
                  </div>
                </div>
                {fetchedModels.deepseek.length > 0 && (
                  <div className={settingsRowClass}>
                    <div className="flex items-center justify-between w-full h-9 pl-9">
                      <span className="text-xs text-zinc-400">Select Model</span>
                      <select
                        value={apiKeys.deepseekModel}
                        onChange={(e) => {
                          const updated = { ...apiKeys, deepseekModel: e.target.value };
                          setApiKeys(updated);
                          saveSettings(updated, theme, bgPreset, enableCloudSync, isRagEnabled, activeModel, fetchedModels);
                        }}
                        className={`bg-transparent border-0 outline-none text-xs text-right max-w-[150px] ${theme === 'light' ? 'text-zinc-800' : 'text-zinc-100'}`}
                      >
                        {fetchedModels.deepseek.map(m => (
                          <option key={m} value={m} className={theme === 'light' ? 'text-zinc-800' : 'text-zinc-100 bg-[#0f0b21]'}>{m}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                {/* Groq Row */}
                <div className={settingsRowClass}>
                  <div className="flex items-center justify-between w-full h-9">
                    <div className="flex items-center gap-2.5">
                      <div className="ios-settings-icon-wrapper bg-blue-500">
                        <Key size={14} />
                      </div>
                      <span className="text-[14px] font-normal">Groq Key</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="password"
                        value={apiKeys.groq}
                        onChange={(e) => {
                          const updated = { ...apiKeys, groq: e.target.value };
                          setApiKeys(updated);
                          saveSettings(updated, theme, bgPreset, enableCloudSync, isRagEnabled, activeModel, fetchedModels);
                        }}
                        placeholder="gsk_..."
                        className={`text-right bg-transparent border-0 outline-none text-xs w-28 ${theme === 'light' ? 'text-zinc-800 placeholder-zinc-300' : 'text-zinc-100 placeholder-zinc-600'}`}
                      />
                      <button
                        onClick={() => fetchModels("groq", apiKeys.groq)}
                        className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase transition-all ${theme === 'light' ? 'bg-indigo-50 text-indigo-600' : 'bg-white/5 text-indigo-400 hover:bg-white/10'}`}
                      >
                        {loadingModels === "groq" ? "..." : "Load"}
                      </button>
                    </div>
                  </div>
                </div>
                {fetchedModels.groq.length > 0 && (
                  <div className={settingsRowClass}>
                    <div className="flex items-center justify-between w-full h-9 pl-9">
                      <span className="text-xs text-zinc-400">Select Model</span>
                      <select
                        value={apiKeys.groqModel}
                        onChange={(e) => {
                          const updated = { ...apiKeys, groqModel: e.target.value };
                          setApiKeys(updated);
                          saveSettings(updated, theme, bgPreset, enableCloudSync, isRagEnabled, activeModel, fetchedModels);
                        }}
                        className={`bg-transparent border-0 outline-none text-xs text-right max-w-[150px] ${theme === 'light' ? 'text-zinc-800' : 'text-zinc-100'}`}
                      >
                        {fetchedModels.groq.map(m => (
                          <option key={m} value={m} className={theme === 'light' ? 'text-zinc-800' : 'text-zinc-100 bg-[#0f0b21]'}>{m}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                {/* OpenRouter Row */}
                <div className={settingsRowClass}>
                  <div className="flex items-center justify-between w-full h-9">
                    <div className="flex items-center gap-2.5">
                      <div className="ios-settings-icon-wrapper bg-[#8e8e93]">
                        <Server size={14} />
                      </div>
                      <span className="text-[14px] font-normal">OpenRouter</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="password"
                        value={apiKeys.openrouter}
                        onChange={(e) => {
                          const updated = { ...apiKeys, openrouter: e.target.value };
                          setApiKeys(updated);
                          saveSettings(updated, theme, bgPreset, enableCloudSync, isRagEnabled, activeModel, fetchedModels);
                        }}
                        placeholder="sk-or-..."
                        className={`text-right bg-transparent border-0 outline-none text-xs w-28 ${theme === 'light' ? 'text-zinc-800 placeholder-zinc-300' : 'text-zinc-100 placeholder-zinc-600'}`}
                      />
                      <button
                        onClick={() => fetchModels("openrouter", apiKeys.openrouter)}
                        className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase transition-all ${theme === 'light' ? 'bg-indigo-50 text-indigo-600' : 'bg-white/5 text-indigo-400 hover:bg-white/10'}`}
                      >
                        {loadingModels === "openrouter" ? "..." : "Load"}
                      </button>
                    </div>
                  </div>
                </div>
                {fetchedModels.openrouter.length > 0 && (
                  <div className={settingsRowClass}>
                    <div className="flex items-center justify-between w-full h-9 pl-9">
                      <span className="text-xs text-zinc-400">Select Model</span>
                      <select
                        value={apiKeys.openrouterModel}
                        onChange={(e) => {
                          const updated = { ...apiKeys, openrouterModel: e.target.value };
                          setApiKeys(updated);
                          saveSettings(updated, theme, bgPreset, enableCloudSync, isRagEnabled, activeModel, fetchedModels);
                        }}
                        className={`bg-transparent border-0 outline-none text-xs text-right max-w-[150px] ${theme === 'light' ? 'text-zinc-800' : 'text-zinc-100'}`}
                      >
                        {fetchedModels.openrouter.map(m => (
                          <option key={m} value={m} className={theme === 'light' ? 'text-zinc-800' : 'text-zinc-100 bg-[#0f0b21]'}>{m}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                {/* Mistral Row */}
                <div className={settingsRowClass}>
                  <div className="flex items-center justify-between w-full h-9">
                    <div className="flex items-center gap-2.5">
                      <div className="ios-settings-icon-wrapper bg-[#8e8e93]">
                        <Key size={14} />
                      </div>
                      <span className="text-[14px] font-normal">Mistral Key</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="password"
                        value={apiKeys.mistral}
                        onChange={(e) => {
                          const updated = { ...apiKeys, mistral: e.target.value };
                          setApiKeys(updated);
                          saveSettings(updated, theme, bgPreset, enableCloudSync, isRagEnabled, activeModel, fetchedModels);
                        }}
                        placeholder="sk-..."
                        className={`text-right bg-transparent border-0 outline-none text-xs w-28 ${theme === 'light' ? 'text-zinc-800 placeholder-zinc-300' : 'text-zinc-100 placeholder-zinc-600'}`}
                      />
                      <button
                        onClick={() => fetchModels("mistral", apiKeys.mistral)}
                        className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase transition-all ${theme === 'light' ? 'bg-indigo-50 text-indigo-600' : 'bg-white/5 text-indigo-400 hover:bg-white/10'}`}
                      >
                        {loadingModels === "mistral" ? "..." : "Load"}
                      </button>
                    </div>
                  </div>
                </div>
                {fetchedModels.mistral.length > 0 && (
                  <div className={settingsRowClass}>
                    <div className="flex items-center justify-between w-full h-9 pl-9">
                      <span className="text-xs text-zinc-400">Select Model</span>
                      <select
                        value={apiKeys.mistralModel}
                        onChange={(e) => {
                          const updated = { ...apiKeys, mistralModel: e.target.value };
                          setApiKeys(updated);
                          saveSettings(updated, theme, bgPreset, enableCloudSync, isRagEnabled, activeModel, fetchedModels);
                        }}
                        className={`bg-transparent border-0 outline-none text-xs text-right max-w-[150px] ${theme === 'light' ? 'text-zinc-800' : 'text-zinc-100'}`}
                      >
                        {fetchedModels.mistral.map(m => (
                          <option key={m} value={m} className={theme === 'light' ? 'text-zinc-800' : 'text-zinc-100 bg-[#0f0b21]'}>{m}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Custom Endpoint */}
            <div className="space-y-2 border-t border-white/5 pt-4">
              <h3 className={`text-[11px] font-semibold uppercase tracking-normal px-1 ${theme === 'light' ? 'text-zinc-500' : 'text-zinc-400'}`}>Custom Endpoint</h3>
              
              <div className={`space-y-2 p-3 ${settingsGroupClass}`}>
                <div className="flex items-center justify-between w-full min-h-[36px] py-1 border-b border-ios-border/10">
                  <span className="text-xs">Base URL</span>
                  <input
                    type="text"
                    value={apiKeys.customUrl}
                    onChange={(e) => {
                      const updated = { ...apiKeys, customUrl: e.target.value };
                      setApiKeys(updated);
                      saveSettings(updated, theme, bgPreset, enableCloudSync, isRagEnabled, activeModel, fetchedModels);
                    }}
                    placeholder="https://api..."
                    className={`text-right bg-transparent border-0 outline-none text-xs w-36 ${theme === 'light' ? 'text-zinc-800 placeholder-zinc-300' : 'text-zinc-100 placeholder-zinc-600'}`}
                  />
                </div>

                <div className="flex items-center justify-between w-full min-h-[36px] py-1 border-b border-ios-border/10">
                  <span className="text-xs">Model Name</span>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={apiKeys.customModel}
                      onChange={(e) => {
                        const updated = { ...apiKeys, customModel: e.target.value };
                        setApiKeys(updated);
                        saveSettings(updated, theme, bgPreset, enableCloudSync, isRagEnabled, activeModel, fetchedModels);
                      }}
                      placeholder="custom-model"
                      className={`text-right bg-transparent border-0 outline-none text-xs w-24 ${theme === 'light' ? 'text-zinc-800 placeholder-zinc-300' : 'text-zinc-100 placeholder-zinc-600'}`}
                    />
                    <button
                      onClick={() => fetchModels("custom", apiKeys.customKey, apiKeys.customUrl)}
                      className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase transition-all ${theme === 'light' ? 'bg-indigo-50 text-indigo-600' : 'bg-white/5 text-indigo-400 hover:bg-white/10'}`}
                    >
                      {loadingModels === "custom" ? "..." : "Load"}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between w-full min-h-[36px] py-1">
                  <span className="text-xs">API Key</span>
                  <input
                    type="password"
                    value={apiKeys.customKey}
                    onChange={(e) => {
                      const updated = { ...apiKeys, customKey: e.target.value };
                      setApiKeys(updated);
                      saveSettings(updated, theme, bgPreset, enableCloudSync, isRagEnabled, activeModel, fetchedModels);
                    }}
                    placeholder="Optional key"
                    className={`text-right bg-transparent border-0 outline-none text-xs w-36 ${theme === 'light' ? 'text-zinc-800 placeholder-zinc-300' : 'text-zinc-100 placeholder-zinc-600'}`}
                  />
                </div>
              </div>
            </div>

            {/* WebMCP Context */}
            <div className="space-y-2 border-t border-white/5 pt-4">
              <div className="flex items-center justify-between px-1">
                <h3 className={`text-[11px] font-semibold uppercase tracking-normal ${theme === 'light' ? 'text-zinc-500' : 'text-zinc-400'}`}>Active Page Context (WebMCP)</h3>
                {pageMcpContext?.available && (
                  <span className="text-[9px] font-bold text-indigo-500 bg-indigo-500/10 px-2 py-0.5 rounded-full border border-indigo-500/10">Active</span>
                )}
              </div>
              
              <div className={settingsGroupClass}>
                {pageMcpContext?.available ? (
                  <>
                    <div className={settingsRowClass}>
                      <div className="flex items-center justify-between w-full h-9">
                        <span className="text-xs font-semibold truncate max-w-[140px]">{pageMcpContext.registryName || "Active Registry"}</span>
                        <span className="text-[10px] text-zinc-500 truncate max-w-[145px]" title={pageMcpContext.url}>{pageMcpContext.url}</span>
                      </div>
                    </div>
                    {pageMcpContext.tools.map((tool) => (
                      <div key={tool.name} className={`${settingsRowClass} flex-col !items-start py-2.5 min-h-[50px] border-b border-ios-border/10 last:border-b-0`}>
                        <span className="text-xs font-bold text-indigo-400">{tool.name}</span>
                        <span className="text-[10px] text-zinc-400 mt-1 leading-normal">{tool.description}</span>
                      </div>
                    ))}
                  </>
                ) : (
                  <div className={`${settingsRowClass} py-3 justify-center text-center`}>
                    <span className="text-[11px] text-zinc-500 leading-normal">No WebMCP tools found on this tab. Legacy DOM automation is active.</span>
                  </div>
                )}
              </div>
            </div>

            {/* Cloud Sync Settings */}
            <div className="space-y-2 border-t border-white/5 pt-4">
              <div className="flex items-center justify-between px-1">
                <h3 className={`text-[11px] font-semibold uppercase tracking-normal ${theme === 'light' ? 'text-zinc-500' : 'text-zinc-400'}`}>Cloud Sync (Supabase)</h3>
                
                <div 
                  onClick={() => {
                    const nextSync = !enableCloudSync;
                    setEnableCloudSync(nextSync);
                    saveSettings(apiKeys, theme, bgPreset, nextSync, isRagEnabled, activeModel, fetchedModels);
                  }}
                  className={`ios-switch ${enableCloudSync ? "ios-switch-active" : "ios-switch-inactive"}`}
                >
                  <div 
                    className="ios-switch-knob"
                    style={{ transform: enableCloudSync ? "translateX(20px)" : "translateX(2px)" }}
                  />
                </div>
              </div>

              {enableCloudSync && (
                <div className={`${settingsGroupClass} animate-fade-in`}>
                  <div className={settingsRowClass}>
                    <div className="flex items-center justify-between w-full h-9">
                      <span className="text-xs">Supabase URL</span>
                      <input
                        type="text"
                        value={apiKeys.supabaseUrl}
                        onChange={(e) => {
                          const updated = { ...apiKeys, supabaseUrl: e.target.value };
                          setApiKeys(updated);
                          saveSettings(updated, theme, bgPreset, enableCloudSync, isRagEnabled, activeModel, fetchedModels);
                        }}
                        placeholder="https://supabase.co"
                        className={`text-right bg-transparent border-0 outline-none text-xs w-36 ${theme === 'light' ? 'text-zinc-800 placeholder-zinc-300' : 'text-zinc-100 placeholder-zinc-600'}`}
                      />
                    </div>
                  </div>

                  <div className={settingsRowClass}>
                    <div className="flex items-center justify-between w-full h-9">
                      <span className="text-xs">Anon Key</span>
                      <input
                        type="password"
                        value={apiKeys.supabaseKey}
                        onChange={(e) => {
                          const updated = { ...apiKeys, supabaseKey: e.target.value };
                          setApiKeys(updated);
                          saveSettings(updated, theme, bgPreset, enableCloudSync, isRagEnabled, activeModel, fetchedModels);
                        }}
                        placeholder="Required"
                        className={`text-right bg-transparent border-0 outline-none text-xs w-36 ${theme === 'light' ? 'text-zinc-800 placeholder-zinc-300' : 'text-zinc-100 placeholder-zinc-600'}`}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </main>
        )}
      </div>

      {/* RIGHT COLUMN: Frosted-Glass Vertical Navigation Deck */}
      <div className={`relative w-12 h-full flex flex-col items-center justify-between border-l border-ios-border bg-opacity-80 py-4 select-none z-20 backdrop-blur-xl transition-colors duration-300 ${theme === 'light' ? 'bg-[#f4f5f8]/95' : 'bg-[#0a0614]/95'}`}>
        <div className="flex flex-col items-center gap-4 w-full">
          {/* Chat Icon Button */}
          <button
            onClick={() => setActiveTab("chat")}
            className={`p-2 rounded-xl transition-all duration-200 ${
              activeTab === "chat"
                ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30 animate-pulse"
                : theme === 'light'
                  ? "text-zinc-500 hover:text-zinc-950 hover:bg-black/5"
                  : "text-zinc-400 hover:text-white hover:bg-white/5"
            }`}
            title="AI Chat"
          >
            <MessageSquare size={16} />
          </button>

          {/* Write Icon Button */}
          <button
            onClick={() => setActiveTab("write")}
            className={`p-2 rounded-xl transition-all duration-200 ${
              activeTab === "write"
                ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30 animate-pulse"
                : theme === 'light'
                  ? "text-zinc-500 hover:text-zinc-950 hover:bg-black/5"
                  : "text-zinc-400 hover:text-white hover:bg-white/5"
            }`}
            title="AI Writer"
          >
            <PenTool size={16} />
          </button>

          {/* Translate Icon Button */}
          <button
            onClick={() => setActiveTab("translate")}
            className={`p-2 rounded-xl transition-all duration-200 ${
              activeTab === "translate"
                ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30 animate-pulse"
                : theme === 'light'
                  ? "text-zinc-500 hover:text-zinc-950 hover:bg-black/5"
                  : "text-zinc-400 hover:text-white hover:bg-white/5"
            }`}
            title="AI Translator"
          >
            <Globe size={16} />
          </button>
        </div>

        <div className="flex flex-col items-center gap-4 w-full">
          {/* Theme Toggle Button */}
          <button
            onClick={() => {
              const newTheme = theme === 'light' ? 'dark' : 'light';
              setTheme(newTheme);
              saveSettings(apiKeys, newTheme, bgPreset, enableCloudSync, isRagEnabled, activeModel, fetchedModels);
            }}
            className={`p-2 rounded-xl transition-colors ${theme === 'light' ? 'text-zinc-500 hover:text-zinc-950 hover:bg-black/5' : 'text-zinc-400 hover:text-white hover:bg-white/5'}`}
            title="Toggle theme"
          >
            {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
          </button>

          {/* Settings Icon Button */}
          <button
            onClick={() => setActiveTab("settings")}
            className={`p-2 rounded-xl transition-all duration-200 ${
              activeTab === "settings"
                ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
                : theme === 'light'
                  ? "text-zinc-500 hover:text-zinc-950 hover:bg-black/5"
                  : "text-zinc-400 hover:text-white hover:bg-white/5"
            }`}
            title="Settings"
          >
            <SettingsIcon size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
