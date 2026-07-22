// Content Script: WebMCP W3C Bridge & Semantic DOM Automation copilot

console.log("Visper: Content Script loaded and initialized.");

interface RegisteredPageTool {
  name: string;
  description: string;
  parameters: Record<string, string>;
}

interface WebMCPRegistry {
  name: string;
  description?: string;
  tools: RegisteredPageTool[];
}

let activePageTools: RegisteredPageTool[] = [];
let pageRegistryName = "";

// Safe storage reader that guards against extension context invalidation (e.g. after extension reload)
function safeGetStorage(keys: string[], callback: (result: Record<string, any>) => void): void {
  try {
    if (typeof chrome !== "undefined" && chrome?.storage?.local) {
      chrome.storage.local.get(keys, (res) => {
        if (chrome.runtime?.lastError) {
          callback({});
        } else {
          callback(res || {});
        }
      });
    } else {
      callback({});
    }
  } catch (e) {
    callback({});
  }
}

// 1. WebMCP Discovery: Listen for custom events dispatched by the page-side application
window.addEventListener("webmcp-register", (event: any) => {
  const detail = event.detail as WebMCPRegistry;
  if (detail && Array.isArray(detail.tools)) {
    activePageTools = detail.tools;
    pageRegistryName = detail.name || "Unnamed Page Context";
    console.log(`Visper: Registered page-side WebMCP tools for: "${pageRegistryName}"`, activePageTools);

    // Notify popup / background service worker of WebMCP availability
    chrome.runtime.sendMessage({
      type: "WEBMCP_PAGE_REGISTERED",
      registryName: pageRegistryName,
      tools: activePageTools,
      url: window.location.href
    }).catch(() => {});
  }
});

// Helper to extract clean text content of the entire webpage body
// Removes navigation panels, menus, scripts, styles, footers, etc. to yield pure content
function extractCleanPageText(): string {
  try {
    const bodyClone = document.body.cloneNode(true) as HTMLElement;
    
    // Remove heavy non-content nodes
    const elementsToRemove = bodyClone.querySelectorAll(
      "script, style, iframe, noscript, svg, header, footer, nav, aside, .header, .footer, .nav, .menu, .sidebar"
    );
    elementsToRemove.forEach(el => el.remove());
    
    // Traverse remaining text nodes
    const walker = document.createTreeWalker(bodyClone, NodeFilter.SHOW_TEXT);
    const textNodes: string[] = [];
    let node;
    while ((node = walker.nextNode())) {
      const text = node.textContent?.trim() || "";
      // Keep meaningful lines of text (length > 3) and avoid duplicates
      if (text.length > 3 && !textNodes.includes(text)) {
        textNodes.push(text);
      }
    }
    
    // Limit to 1000 lines to prevent context size overflow (well under token limits)
    return textNodes.slice(0, 1000).join("\n");
  } catch (e) {
    console.warn("Failed to extract clean page text:", e);
    // Fallback: simple textContent scrape
    return document.body.innerText || "";
  }
}


// Helper to determine element visibility
function isElementVisible(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  const style = window.getComputedStyle(el);
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    style.opacity !== "0"
  );
}

// 2. Semantic Element Matcher: Resolves elements on legacy pages without formal WebMCP integration
function findElementSemantically(tag?: string, text?: string, selector?: string): HTMLElement | null {
  const targetText = text ? text.trim().toLowerCase().replace(/\s+/g, " ") : "";
  const targetTag = tag ? tag.trim().toUpperCase() : "";

  // Strategy A: Try matching selector directly
  if (selector) {
    try {
      const element = document.querySelector(selector) as HTMLElement;
      if (element && isElementVisible(element)) return element;
    } catch (e) {
      console.warn("Visper: Invalid CSS selector fallback query:", selector);
    }
  }

  // Strategy B: Match tags and compute semantic relevance score
  // Include all interactive tags even if targetTag is specified, to catch custom divs, links, labels, and form buttons
  const allTags = ["BUTTON", "INPUT", "A", "LABEL", "TEXTAREA", "DIV", "SPAN", "SELECT"];
  const tagsToSearch = targetTag ? [targetTag, ...allTags.filter(t => t !== targetTag)] : allTags;
  const candidates: { el: HTMLElement; score: number }[] = [];

  const isAddToCartQuery = targetText.includes("add to cart") || targetText.includes("add to bag") || targetText.includes("buy now") || targetText === "cart";
  const isSizeQuery = targetText === "s" || targetText === "m" || targetText === "l" || targetText === "xl" || targetText === "xxl" || targetText === "small" || targetText === "medium" || targetText === "large" || targetText === "extra large";

  for (const t of tagsToSearch) {
    const isPrimaryTag = targetTag ? t === targetTag : true;
    const tagWeightMultiplier = isPrimaryTag ? 1.0 : 0.8;
    const elements = document.getElementsByTagName(t);

    for (let i = 0; i < elements.length; i++) {
      const el = elements[i] as HTMLElement;
      if (!isElementVisible(el)) continue;

      let score = 0;
      const rawText = el.textContent?.trim().toLowerCase().replace(/\s+/g, " ") || "";
      const elAria = el.getAttribute("aria-label")?.trim().toLowerCase() || "";
      const elPlaceholder = el.getAttribute("placeholder")?.trim().toLowerCase() || "";
      const elName = el.getAttribute("name")?.trim().toLowerCase() || "";
      const elValue = (el as HTMLInputElement).value?.trim().toLowerCase() || el.getAttribute("value")?.trim().toLowerCase() || "";
      const elDataVal = el.getAttribute("data-value")?.trim().toLowerCase() || el.getAttribute("data-option-value")?.trim().toLowerCase() || "";
      const elId = el.id.toLowerCase();
      const elClass = el.className.toLowerCase();
      const elDataAction = el.getAttribute("data-action")?.trim().toLowerCase() || "";

      // E-commerce Special Heuristics (Shopify, WooCommerce, Daraz, Magento)
      if (isAddToCartQuery) {
        if (elName === "add" || elDataAction === "add-to-cart" || elId.includes("addtocart") || elId.includes("add-to-cart")) {
          score += 200;
        }
        if (elClass.includes("add-to-cart") || elClass.includes("btn-cart") || elClass.includes("product-form__submit")) {
          score += 160;
        }
        if (el.closest("form[action*='/cart']") || el.closest(".product-form")) {
          score += 80;
        }
      }

      if (isSizeQuery) {
        if (elDataVal === targetText || elValue === targetText || elName.includes("size") || elName.includes("option")) {
          score += 180;
        }
        if (rawText === targetText || rawText === targetText.toUpperCase()) {
          score += 150;
        }
      }

      if (targetText) {
        // 1. Direct Content Match
        if (rawText === targetText) score += 120;
        else if (rawText.includes(targetText)) score += 60;

        // 2. Aria-Label match
        if (elAria === targetText) score += 130;
        else if (elAria.includes(targetText)) score += 65;

        // 3. Input value & placeholder match
        if (elValue === targetText) score += 110;
        else if (elValue.includes(targetText)) score += 55;
        if (elPlaceholder === targetText) score += 110;
        else if (elPlaceholder.includes(targetText)) score += 55;

        // 4. Name attribute match
        if (elName === targetText) score += 90;
        else if (elName.includes(targetText)) score += 45;

        // 5. Element details (Id/Class)
        if (elId && elId.includes(targetText)) score += 30;
        if (elClass && elClass.includes(targetText)) score += 20;

        // 5b. Anchor href attribute match (A tags) and Title attribute match
        if (t === "A") {
          const elHref = el.getAttribute("href")?.trim().toLowerCase() || "";
          if (elHref && elHref.includes(targetText)) score += 85;
        }
        const elTitle = el.getAttribute("title")?.trim().toLowerCase() || "";
        if (elTitle && elTitle.includes(targetText)) score += 50;

        // 6. Label-Association Matches (Critical for Form Fields & Radio Pills)
        if (t === "INPUT" || t === "TEXTAREA" || t === "SELECT" || t === "LABEL") {
          if (el.id) {
            const labelEl = document.querySelector(`label[for="${el.id}"]`);
            if (labelEl) {
              const labelText = labelEl.textContent?.trim().toLowerCase() || "";
              if (labelText === targetText) score += 160;
              else if (labelText.includes(targetText)) score += 80;
            }
          }

          const parentLabel = el.closest("label");
          if (parentLabel) {
            const labelText = parentLabel.textContent?.trim().toLowerCase() || "";
            if (labelText === targetText) score += 140;
            else if (labelText.includes(targetText)) score += 70;
          }
        }
      } else {
        score += 1;
      }

      if (score > 0) {
        candidates.push({ el, score: score * tagWeightMultiplier });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.length > 0 ? candidates[0].el : null;
}

async function getYoutubePlayerResponse(): Promise<any> {
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_MAIN_WORLD_YT_RESPONSE" }).catch(() => null);
    if (response && response.success && response.result) {
      return response.result;
    }

    const scripts = document.getElementsByTagName("script");
    for (let i = 0; i < scripts.length; i++) {
      const text = scripts[i].textContent || "";
      if (text.includes("ytInitialPlayerResponse") && !text.includes("function") && !text.includes("visper-yt-bridge")) {
        let startIdx = text.indexOf("ytInitialPlayerResponse = ");
        if (startIdx !== -1) {
          startIdx += "ytInitialPlayerResponse = ".length;
        } else {
          startIdx = text.indexOf('ytInitialPlayerResponse["');
          if (startIdx !== -1) {
            startIdx = text.indexOf(" = ", startIdx) + 3;
          } else {
            startIdx = text.indexOf("ytInitialPlayerResponse");
            if (startIdx !== -1) {
              startIdx = text.indexOf("=", startIdx) + 1;
            }
          }
        }
        if (startIdx === -1) continue;
        
        let raw = text.substring(startIdx).trim();
        if (raw.endsWith(";")) {
          raw = raw.slice(0, -1);
        }
        
        let braceCount = 0;
        let jsonStr = "";
        for (let j = 0; j < raw.length; j++) {
          const char = raw[j];
          if (char === "{") {
            braceCount++;
          } else if (char === "}") {
            braceCount--;
          }
          jsonStr += char;
          if (braceCount === 0 && jsonStr.startsWith("{")) {
            break;
          }
        }
        
        try {
          return JSON.parse(jsonStr);
        } catch (e) {
          console.error("Failed to parse ytInitialPlayerResponse JSON fallback:", e);
        }
      }
    }
  } catch (err) {
    console.error("Error in getYoutubePlayerResponse:", err);
  }
  return null;
}

async function scrapeYoutubeDomTranscript(): Promise<{ text: string; start: number; duration: number }[] | null> {
  try {
    let segments = Array.from(document.querySelectorAll("ytd-transcript-segment-renderer, .ytd-transcript-segment-renderer"));
    
    if (segments.length === 0) {
      // 1. Expand description if collapsed
      const expandBtn = document.querySelector("#expand, #description-inline-expander #expand, ytd-text-inline-expander #expand") as HTMLElement;
      if (expandBtn) {
        expandBtn.click();
        await new Promise(r => setTimeout(r, 250));
      }

      // 2. Click "Show transcript" button in YouTube UI
      const allBtns = Array.from(document.querySelectorAll("button, ytd-button-renderer, a, div[role='button']"));
      const transcriptBtn = allBtns.find(el => {
        const txt = (el.textContent || "").toLowerCase();
        const aria = (el.getAttribute("aria-label") || "").toLowerCase();
        return txt.includes("show transcript") || txt.includes("transcript") || aria.includes("transcript") || txt.includes("ٹرانسکریپٹ");
      }) as HTMLElement;

      if (transcriptBtn) {
        transcriptBtn.click();
        await new Promise(r => setTimeout(r, 600));
        segments = Array.from(document.querySelectorAll("ytd-transcript-segment-renderer, .ytd-transcript-segment-renderer"));
      }
    }

    if (segments.length === 0) return null;

    const result: { text: string; start: number; duration: number }[] = [];
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const timeEl = seg.querySelector(".segment-timestamp, [class*='timestamp']");
      const textEl = seg.querySelector(".segment-text, [class*='segment-text']");
      
      const timeStr = timeEl?.textContent?.trim() || "0:00";
      const textStr = textEl?.textContent?.trim() || "";

      const parts = timeStr.split(":").map(p => parseFloat(p) || 0);
      let seconds = 0;
      if (parts.length === 3) seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
      else if (parts.length === 2) seconds = parts[0] * 60 + parts[1];
      else seconds = parts[0] || 0;

      if (textStr) {
        result.push({ text: textStr, start: seconds, duration: 2 });
      }
    }

    return result.length > 0 ? result : null;
  } catch (e) {
    console.warn("scrapeYoutubeDomTranscript error:", e);
    return null;
  }
}

function startOcrCapture() {
  const overlay = document.createElement("div");
  overlay.id = "visper-ocr-overlay";
  overlay.style.position = "fixed";
  overlay.style.top = "0";
  overlay.style.left = "0";
  overlay.style.width = "100vw";
  overlay.style.height = "100vh";
  overlay.style.backgroundColor = "rgba(0, 0, 0, 0.4)";
  overlay.style.zIndex = "2147483647";
  overlay.style.cursor = "crosshair";
  overlay.style.userSelect = "none";
  document.body.appendChild(overlay);

  const cropBox = document.createElement("div");
  cropBox.style.position = "absolute";
  cropBox.style.border = "2px dashed #a855f7";
  cropBox.style.boxShadow = "0 0 12px #a855f7, 0 0 0 9999px rgba(0, 0, 0, 0.5)";
  cropBox.style.pointerEvents = "none";
  cropBox.style.display = "none";
  overlay.appendChild(cropBox);

  const badge = document.createElement("div");
  badge.style.position = "absolute";
  badge.style.top = "20px";
  badge.style.left = "50%";
  badge.style.transform = "translateX(-50%)";
  badge.style.background = "rgba(10, 6, 20, 0.85)";
  badge.style.color = "white";
  badge.style.padding = "6px 12px";
  badge.style.borderRadius = "20px";
  badge.style.fontSize = "12px";
  badge.style.fontFamily = "sans-serif";
  badge.style.border = "1px solid rgba(255, 255, 255, 0.15)";
  badge.style.boxShadow = "0 4px 12px rgba(0,0,0,0.5)";
  badge.style.pointerEvents = "none";
  badge.innerText = "Drag a rectangle to crop area. Press ESC to cancel.";
  overlay.appendChild(badge);

  let startX = 0;
  let startY = 0;
  let isDrawing = false;

  const handleMouseDown = (e: MouseEvent) => {
    startX = e.clientX;
    startY = e.clientY;
    isDrawing = true;
    cropBox.style.display = "block";
    cropBox.style.left = `${startX}px`;
    cropBox.style.top = `${startY}px`;
    cropBox.style.width = "0px";
    cropBox.style.height = "0px";
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDrawing) return;
    const currentX = e.clientX;
    const currentY = e.clientY;
    const left = Math.min(startX, currentX);
    const top = Math.min(startY, currentY);
    const width = Math.abs(startX - currentX);
    const height = Math.abs(startY - currentY);
    cropBox.style.left = `${left}px`;
    cropBox.style.top = `${top}px`;
    cropBox.style.width = `${width}px`;
    cropBox.style.height = `${height}px`;
  };

  const handleMouseUp = (e: MouseEvent) => {
    if (!isDrawing) return;
    isDrawing = false;
    const endX = e.clientX;
    const endY = e.clientY;
    const left = Math.min(startX, endX);
    const top = Math.min(startY, endY);
    const width = Math.abs(startX - endX);
    const height = Math.abs(startY - endY);

    cleanup();

    if (width > 5 && height > 5) {
      chrome.runtime.sendMessage({
        type: "OCR_REGION_SELECTED",
        x: left,
        y: top,
        width: width,
        height: height,
        dpr: window.devicePixelRatio
      }).catch(() => {});
    }
  };

  const handleEsc = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      cleanup();
    }
  };

  const cleanup = () => {
    overlay.remove();
    document.removeEventListener("keydown", handleEsc);
    overlay.removeEventListener("mousedown", handleMouseDown);
    overlay.removeEventListener("mousemove", handleMouseMove);
    overlay.removeEventListener("mouseup", handleMouseUp);
  };

  overlay.addEventListener("mousedown", handleMouseDown);
  overlay.addEventListener("mousemove", handleMouseMove);
  overlay.addEventListener("mouseup", handleMouseUp);
  document.addEventListener("keydown", handleEsc);
}

// 3. Extension message listener to act as bridge between sidebar agent and DOM
chrome.runtime.onMessage.addListener((message: any, _sender: any, sendResponse: (res?: any) => void) => {
  console.log("Visper Content Script received query action:", message.type);

  // A. Check current WebMCP availability
  if (message.type === "CHECK_WEBMCP") {
    const hasWebMCP = "modelContext" in navigator || activePageTools.length > 0;
    sendResponse({
      available: hasWebMCP,
      registryName: pageRegistryName,
      tools: activePageTools,
      url: window.location.href
    });
    return false;
  }

  // A2. Extract visible text content of page for summarizer
  if (message.type === "EXTRACT_PAGE_CONTENT") {
    try {
      const title = document.title || "";
      const cleanedText = extractCleanPageText();
      sendResponse({
        success: true,
        title,
        text: cleanedText,
        url: window.location.href
      });
    } catch (e: any) {
      sendResponse({ success: false, error: e.message });
    }
    return false;
  }

  // A3. Insert text at the currently active element (for Write mode integration)
  if (message.type === "INSERT_TEXT") {
    try {
      const activeEl = document.activeElement as HTMLInputElement | HTMLTextAreaElement;
      if (activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA" || activeEl.isContentEditable)) {
        if (activeEl.isContentEditable) {
          activeEl.innerText = message.text;
        } else {
          activeEl.value = message.text;
        }
        // Dispatch input/change events so React/Vue sites detect the change
        activeEl.dispatchEvent(new Event('input', { bubbles: true }));
        activeEl.dispatchEvent(new Event('change', { bubbles: true }));
        sendResponse({ success: true, message: "Inserted text into focused element successfully." });
      } else {
        sendResponse({ success: false, error: "Please click inside a webpage input field or textbox first." });
      }
    } catch (e: any) {
      sendResponse({ success: false, error: e.message });
    }
    return false;
  }
  if (message.type === "WEBMCP_CALL_TOOL") {
    const callId = Math.random().toString(36).substring(2) + Date.now().toString(36);

    const onToolResult = (event: any) => {
      if (event.detail && event.detail.callId === callId) {
        window.removeEventListener("webmcp-tool-response", onToolResult);
        sendResponse({ success: true, result: event.detail.result });
      }
    };

    window.addEventListener("webmcp-tool-response", onToolResult);

    // Forward call event to page sandbox
    window.dispatchEvent(new CustomEvent("webmcp-call-tool", {
      detail: {
        callId,
        tool: message.tool,
        arguments: message.arguments
      }
    }));

    return true; // Keep channel open for async response
  }

  // C. Execute legacy semantic action (Click, Fill, Focus, Scrape)
  if (message.type === "DOM_INTERACT") {
    if (message.action === "extract_page_content" || message.action === "extract_page") {
      try {
        const title = document.title || "";
        const cleanedText = extractCleanPageText();
        sendResponse({
          success: true,
          message: `Extracted text from page "${title}"`,
          title,
          text: cleanedText,
          url: window.location.href
        });
      } catch (e: any) {
        sendResponse({ success: false, error: `Page content extraction failed: ${e.message}` });
      }
      return false;
    }

    const element = findElementSemantically(message.tag, message.text, message.selector);
    if (!element) {
      sendResponse({ success: false, error: "Target semantic element was not found in page DOM." });
      return false;
    }

    try {
      const desc = {
        tagName: element.tagName,
        id: element.id,
        className: element.className,
        text: element.textContent?.trim().slice(0, 40)
      };

      if (message.action === "click") {
        element.click();
        sendResponse({ success: true, message: "Clicked element successfully.", element: desc });
      } else if (message.action === "fill") {
        const inputEl = element as HTMLInputElement | HTMLTextAreaElement;
        inputEl.value = message.value || "";
        inputEl.dispatchEvent(new Event("input", { bubbles: true }));
        inputEl.dispatchEvent(new Event("change", { bubbles: true }));
        
        // Dispatch Enter key and form submit for search inputs
        if (inputEl.form) {
          try {
            if (inputEl.form.requestSubmit) inputEl.form.requestSubmit();
            else inputEl.form.submit();
          } catch (e) {
            // Fallback to keydown
            inputEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
          }
        } else {
          inputEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
        }
        sendResponse({ success: true, message: "Filled input value and triggered submission.", element: desc });
      } else if (message.action === "focus") {
        element.focus();
        sendResponse({ success: true, message: "Focused element successfully.", element: desc });
      } else {
        sendResponse({ success: false, error: `Unsupported interaction action: ${message.action}` });
      }
    } catch (err: any) {
      sendResponse({ success: false, error: `Interaction failed: ${err.message}` });
    }
    return false;
  }

  if (message.type === "START_OCR_CAPTURE") {
    try {
      startOcrCapture();
      sendResponse({ success: true });
    } catch (e: any) {
      sendResponse({ success: false, error: e.message });
    }
    return false;
  }

  if (message.type === "GET_YOUTUBE_TRANSCRIPT") {
    (async () => {
      try {
        if (!window.location.host.includes("youtube.com") || !window.location.pathname.includes("/watch")) {
          sendResponse({ success: false, error: "Not on a YouTube watch page." });
          return;
        }

        const playerResponse = await getYoutubePlayerResponse();
        if (!playerResponse) {
          sendResponse({ success: false, error: "Could not retrieve YouTube player response. Make sure the page is fully loaded." });
          return;
        }

        const videoTitle = playerResponse.videoDetails?.title || document.title;
        const videoId = playerResponse.videoDetails?.videoId || "";
        const description = playerResponse.videoDetails?.shortDescription || "";

        const captionTracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        if (!captionTracks || captionTracks.length === 0) {
          sendResponse({
            success: true,
            transcript: null,
            title: videoTitle,
            videoId,
            description
          });
          return;
        }

        let transcript: { text: string; start: number; duration: number }[] = [];

        // Candidate track search in order: English -> Urdu -> Any language (Arabic, Spanish, Hindi, Turkish, French, German, etc.)
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
            
            // Try parsing XML format (<text start="0">...</text>)
            if (rawText.includes("<text")) {
              const parser = new DOMParser();
              const xmlDoc = parser.parseFromString(rawText, "text/xml");
              const textNodes = xmlDoc.getElementsByTagName("text");
              for (let i = 0; i < textNodes.length; i++) {
                const node = textNodes[i];
                const text = node.textContent || "";
                const start = parseFloat(node.getAttribute("start") || "0");
                const duration = parseFloat(node.getAttribute("dur") || "0");
                const cleanText = text
                  .replace(/&amp;/g, "&")
                  .replace(/&lt;/g, "<")
                  .replace(/&gt;/g, ">")
                  .replace(/&quot;/g, '"')
                  .replace(/&#39;/g, "'")
                  .replace(/&apos;/g, "'")
                  .trim();
                if (cleanText) {
                  transcript.push({ text: cleanText, start, duration });
                }
              }
              if (transcript.length > 0) break;
            }
          } catch (e) {
            console.warn("Failed to fetch caption track:", e);
          }
        }

        // Fallback 1: Try background service worker caption fetcher (bypasses CORS completely)
        if (transcript.length === 0 && captionTracks && captionTracks.length > 0) {
          try {
            const bgRes: any = await new Promise(res => {
              chrome.runtime.sendMessage({ type: "FETCH_YOUTUBE_CAPTION_BACKGROUND", captionTracks }, res);
            });
            if (bgRes && bgRes.success && bgRes.transcript) {
              transcript = bgRes.transcript;
            }
          } catch (e) {
            console.warn("Background caption fetch fallback failed:", e);
          }
        }

        // Fallback 2: Native YouTube UI DOM Clicker & Scraper (clicks "Show transcript" button)
        if (transcript.length === 0) {
          const domTranscript = await scrapeYoutubeDomTranscript();
          if (domTranscript && domTranscript.length > 0) {
            transcript = domTranscript;
          }
        }

        sendResponse({
          success: true,
          transcript: transcript.length > 0 ? transcript : null,
          title: videoTitle,
          videoId: videoId,
          description: description
        });
      } catch (e: any) {
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true; // Keep channel open for async response
  }

  if (message.type === "YOUTUBE_SEEK") {
    try {
      const video = document.querySelector("video");
      if (video) {
        video.currentTime = message.time;
        video.play().catch(() => {});
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: "No video element found." });
      }
    } catch (e: any) {
      sendResponse({ success: false, error: e.message });
    }
    return false;
  }

  return false;
});

// 4. Floating Glassmorphic Quick-Action Menu (Highlight to Assist - Shadow DOM Evolved)
(() => {
  let tooltipHost: HTMLDivElement | null = null;
  let shadowRoot: ShadowRoot | null = null;
  let selectedText = "";

  const removeMenu = () => {
    if (tooltipHost) {
      tooltipHost.remove();
      tooltipHost = null;
      shadowRoot = null;
    }
  };

  document.addEventListener("mouseup", (e) => {
    // Small delay to let selection settle
    setTimeout(() => {
      const selection = window.getSelection();
      const text = selection ? selection.toString().trim() : "";

      // If clicked inside the tooltip host, do not dismiss it
      if (tooltipHost && tooltipHost.contains(e.target as Node)) return;

      if (!text || text.length < 5) {
        removeMenu();
        return;
      }

      // Check if active page protocol is restricted (e.g. extension itself, chrome pages)
      const BLOCKED_PROTOCOLS = ["chrome://", "chrome-extension://", "about:", "edge://", "brave://"];
      if (BLOCKED_PROTOCOLS.some(p => window.location.href.startsWith(p))) {
        return;
      }

      // Prevent showing on input fields/textareas to avoid typing collision
      const activeNode = document.activeElement;
      if (activeNode && (activeNode.tagName === "INPUT" || activeNode.tagName === "TEXTAREA" || (activeNode as HTMLElement).isContentEditable)) {
        return;
      }

      const range = selection!.getRangeAt(0);
      const rects = range.getClientRects();
      if (rects.length === 0) return;

      selectedText = text;
      const firstRect = rects[0];
      
      // Calculate coordinates centered above the selection bounds
      const left = window.scrollX + (firstRect.left + firstRect.width / 2);
      const top = window.scrollY + firstRect.top - 44; // 44px above selection

      removeMenu();

      // Create Shadow Host Container
      tooltipHost = document.createElement("div");
      tooltipHost.id = "visper-tooltip-shadow-host";
      tooltipHost.style.position = "absolute";
      tooltipHost.style.left = `${left}px`;
      tooltipHost.style.top = `${top}px`;
      tooltipHost.style.zIndex = "2147483647";
      tooltipHost.style.pointerEvents = "auto";
      document.body.appendChild(tooltipHost);

      // Attach Closed Shadow DOM
      shadowRoot = tooltipHost.attachShadow({ mode: "closed" });

      // Fetch user theme settings to style accordingly
      safeGetStorage(["theme"], (res) => {
        const theme = res.theme || "dark";
        const isDark = theme === "dark";

        shadowRoot!.innerHTML = `
          <style>
            .tooltip-container {
              transform: translateX(-50%);
              display: flex;
              align-items: center;
              gap: 4px;
              padding: 4px 6px;
              border-radius: 12px;
              backdrop-filter: blur(16px) saturate(190%);
              -webkit-backdrop-filter: blur(16px) saturate(190%);
              box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35), inset 0px 1px 0px ${isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(255, 255, 255, 0.5)"};
              pointer-events: auto;
              font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Icons", "Segoe UI", Roboto, sans-serif;
              animation: fade-in 0.15s cubic-bezier(0.16, 1, 0.3, 1);
              background: ${isDark ? "rgba(10, 6, 20, 0.88)" : "rgba(255, 255, 255, 0.9)"};
              border: 1px solid ${isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)"};
            }
            @keyframes fade-in {
              from { opacity: 0; transform: translateX(-50%) translateY(4px) scale(0.96); }
              to { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
            }
            .action-btn {
              background: transparent;
              border: none;
              outline: none;
              cursor: pointer;
              font-size: 11px;
              font-weight: 600;
              padding: 5px 8px;
              border-radius: 8px;
              display: flex;
              align-items: center;
              gap: 4px;
              transition: all 0.2s ease-in-out;
              color: ${isDark ? "rgba(255, 255, 255, 0.85)" : "rgba(0, 0, 0, 0.75)"};
            }
            .action-btn:hover {
              background: ${isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.04)"};
              color: ${isDark ? "#ffffff" : "#000000"};
              transform: translateY(-0.5px);
            }
            .action-btn:active {
              transform: translateY(0);
            }
            .divider {
              width: 1px;
              height: 12px;
              background: ${isDark ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 0, 0, 0.08)"};
            }
          </style>
          <div class="tooltip-container">
            <button class="action-btn" data-action="Explain">💬 Explain</button>
            <div class="divider"></div>
            <button class="action-btn" data-action="Summarize">📝 Summarize</button>
            <div class="divider"></div>
            <button class="action-btn" data-action="Translate">🌐 Translate</button>
            <div class="divider"></div>
            <button class="action-btn" data-action="Rewrite">✍️ Rewrite</button>
          </div>
        `;

        // Bind button actions
        const buttons = shadowRoot!.querySelectorAll(".action-btn");
        buttons.forEach((btn) => {
          btn.addEventListener("click", (evt) => {
            const action = (evt.currentTarget as HTMLButtonElement).getAttribute("data-action") || "Explain";
            chrome.runtime.sendMessage({
              type: "QUICK_ACTION",
              action: action,
              text: selectedText
            }).catch(() => {});
            removeMenu();
            window.getSelection()?.removeAllRanges();
          });
        });
      });
    }, 10);
  });

  // Clear menu on clicking anywhere else
  document.addEventListener("mousedown", (e) => {
    if (tooltipHost && !tooltipHost.contains(e.target as Node)) {
      // Small timeout to allow action click listeners inside shadow DOM to execute first
      setTimeout(removeMenu, 120);
    }
  });
})();

// 5. Injected Input Box Sparkle Composer (Inline AI Writer - Phase 6)
(() => {
  let sparkleHost: HTMLDivElement | null = null;
  let capsuleHost: HTMLDivElement | null = null;
  let activeInputElement: HTMLElement | null = null;
  let isCapsuleOpen = false;
  let activeStreamChunks = "";

  const removeSparkle = () => {
    if (sparkleHost && !isCapsuleOpen) {
      sparkleHost.remove();
      sparkleHost = null;
    }
  };

  const removeCapsule = () => {
    if (capsuleHost) {
      capsuleHost.remove();
      capsuleHost = null;
      isCapsuleOpen = false;
    }
    removeSparkle();
  };

  // Helper to insert text into the active input element
  const insertTextIntoInput = (text: string, mode: "replace" | "insert") => {
    if (!activeInputElement) return;
    const el = activeInputElement as HTMLInputElement | HTMLTextAreaElement;
    
    if (el.isContentEditable) {
      if (mode === "replace") {
        el.innerText = text;
      } else {
        // Insert at current selection inside contenteditable
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          range.deleteContents();
          range.insertNode(document.createTextNode(text));
        } else {
          el.innerText += text;
        }
      }
    } else {
      const val = el.value || "";
      if (mode === "replace") {
        el.value = text;
      } else {
        const start = el.selectionStart || 0;
        const end = el.selectionEnd || 0;
        el.value = val.substring(0, start) + text + val.substring(end);
        el.selectionStart = el.selectionEnd = start + text.length;
      }
    }

    // Trigger standard DOM input and change events so page frameworks detect changes
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.focus();
  };

  // Monitor input focus
  document.addEventListener("focusin", (e) => {
    const target = e.target as HTMLElement;
    if (!target) return;

    const isInput = target.tagName === "INPUT" && !["password", "checkbox", "radio", "file", "submit", "button", "hidden"].includes((target as HTMLInputElement).type);
    const isTextArea = target.tagName === "TEXTAREA";
    const isContentEditable = target.isContentEditable;

    if (isInput || isTextArea || isContentEditable) {
      activeInputElement = target;
      
      // Position the sparkle badge
      setTimeout(() => {
        if (isCapsuleOpen || activeInputElement !== target) return;

        const rect = target.getBoundingClientRect();
        
        // Skip tiny inputs (like single digit boxes)
        if (rect.width < 60 || rect.height < 20) return;

        // Position at bottom right corner inside the input box (with small offset)
        const left = window.scrollX + rect.left + rect.width - 24;
        const top = window.scrollY + rect.top + rect.height - 24;

        if (sparkleHost) sparkleHost.remove();

        sparkleHost = document.createElement("div");
        sparkleHost.id = "visper-sparkle-shadow-host";
        sparkleHost.style.position = "absolute";
        sparkleHost.style.left = `${left}px`;
        sparkleHost.style.top = `${top}px`;
        sparkleHost.style.width = "20px";
        sparkleHost.style.height = "20px";
        sparkleHost.style.zIndex = "2147483645";
        sparkleHost.style.pointerEvents = "auto";
        document.body.appendChild(sparkleHost);

        const shadow = sparkleHost.attachShadow({ mode: "closed" });

        safeGetStorage(["theme"], (res) => {
          const theme = res.theme || "dark";
          const isDark = theme === "dark";

          shadow.innerHTML = `
            <style>
              .sparkle-btn {
                width: 20px;
                height: 20px;
                border-radius: 50%;
                background: linear-gradient(135deg, #a855f7, #6366f1);
                color: #ffffff;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                font-size: 11px;
                box-shadow: 0 2px 8px rgba(168, 85, 247, 0.4);
                transition: transform 0.2s ease, box-shadow 0.2s ease;
                border: 1px solid ${isDark ? "rgba(255, 255, 255, 0.15)" : "rgba(0, 0, 0, 0.08)"};
                outline: none;
              }
              .sparkle-btn:hover {
                transform: scale(1.15);
                box-shadow: 0 4px 12px rgba(168, 85, 247, 0.6);
              }
            </style>
            <button class="sparkle-btn" title="Write with Visper">✨</button>
          `;

          const btn = shadow.querySelector(".sparkle-btn");
          btn?.addEventListener("mousedown", (evt) => {
            evt.preventDefault();
            evt.stopPropagation();
            openComposerCapsule();
          });
        });
      }, 50);
    }
  });

  // Delayed removal on blur (allows click inside sparkle or capsule to process first)
  document.addEventListener("focusout", () => {
    setTimeout(() => {
      // If we focused onto another node inside the shadow DOMs, don't remove
      const active = document.activeElement;
      if (sparkleHost && sparkleHost.contains(active)) return;
      if (capsuleHost && capsuleHost.contains(active)) return;
      
      removeSparkle();
    }, 200);
  });

  // Open the Floating mini composer capsule
  const openComposerCapsule = () => {
    if (!activeInputElement) return;
    
    isCapsuleOpen = true;
    if (sparkleHost) {
      sparkleHost.remove();
      sparkleHost = null;
    }

    const rect = activeInputElement.getBoundingClientRect();
    
    // Position below the element, aligned to the right edge of element
    const left = window.scrollX + rect.left + rect.width - 320; // 320px width of capsule
    const top = window.scrollY + rect.top + rect.height + 6;

    if (capsuleHost) capsuleHost.remove();

    capsuleHost = document.createElement("div");
    capsuleHost.id = "visper-capsule-shadow-host";
    capsuleHost.style.position = "absolute";
    capsuleHost.style.left = `${Math.max(10, left)}px`;
    capsuleHost.style.top = `${top}px`;
    capsuleHost.style.zIndex = "2147483646";
    capsuleHost.style.pointerEvents = "auto";
    document.body.appendChild(capsuleHost);

    const shadow = capsuleHost.attachShadow({ mode: "closed" });

    safeGetStorage(["theme", "activeModel", "apiKeys"], (res) => {
      const theme = res.theme || "dark";
      const isDark = theme === "dark";
      const activeModel = res.activeModel || "openrouter";
      const apiKeys = res.apiKeys || {};

      shadow.innerHTML = `
        <style>
          .capsule-card {
            width: 320px;
            border-radius: 14px;
            backdrop-filter: blur(20px) saturate(190%);
            -webkit-backdrop-filter: blur(20px) saturate(190%);
            box-shadow: 0 10px 38px rgba(0, 0, 0, 0.4), inset 0px 1px 0px ${isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(255, 255, 255, 0.5)"};
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            animation: slide-up 0.2s cubic-bezier(0.16, 1, 0.3, 1);
            background: ${isDark ? "rgba(12, 8, 25, 0.92)" : "rgba(255, 255, 255, 0.94)"};
            border: 1px solid ${isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.08)"};
            color: ${isDark ? "#e4e4e7" : "#18181b"};
            display: flex;
            flex-direction: column;
            overflow: hidden;
          }
          @keyframes slide-up {
            from { opacity: 0; transform: translateY(8px) scale(0.97); }
            to { opacity: 1; transform: translateY(0) scale(1); }
          }
          .header {
            padding: 8px 12px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            border-bottom: 1px solid ${isDark ? "rgba(255, 255, 255, 0.06)" : "rgba(0, 0, 0, 0.05)"};
          }
          .title {
            font-size: 11px;
            font-weight: 700;
            color: ${isDark ? "#c084fc" : "#7c3aed"};
            display: flex;
            align-items: center;
            gap: 4px;
          }
          .close-btn {
            background: transparent;
            border: none;
            cursor: pointer;
            font-size: 10px;
            color: ${isDark ? "rgba(255, 255, 255, 0.4)" : "rgba(0, 0, 0, 0.4)"};
            transition: color 0.15s ease;
          }
          .close-btn:hover {
            color: ${isDark ? "#ffffff" : "#000000"};
          }
          .body {
            padding: 10px;
            display: flex;
            flex-direction: column;
            gap: 8px;
          }
          textarea {
            width: 100%;
            height: 52px;
            border-radius: 8px;
            padding: 6px 8px;
            font-size: 11px;
            font-family: inherit;
            resize: none;
            box-sizing: border-box;
            background: ${isDark ? "rgba(255, 255, 255, 0.04)" : "#f4f4f5"};
            border: 1px solid ${isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.08)"};
            color: inherit;
            outline: none;
            transition: border-color 0.15s ease;
          }
          textarea:focus {
            border-color: #a855f7;
          }
          .templates-row {
            display: flex;
            flex-wrap: wrap;
            gap: 4px;
          }
          .template-btn {
            background: ${isDark ? "rgba(255, 255, 255, 0.05)" : "rgba(0,0,0,0.04)"};
            border: 1px solid ${isDark ? "rgba(255, 255, 255, 0.05)" : "rgba(0,0,0,0.03)"};
            font-size: 10px;
            font-weight: 500;
            padding: 3px 6px;
            border-radius: 6px;
            cursor: pointer;
            transition: all 0.15s ease;
            color: ${isDark ? "rgba(255,255,255,0.7)" : "rgba(0,0,0,0.7)"};
          }
          .template-btn:hover {
            background: rgba(168, 85, 247, 0.15);
            border-color: rgba(168, 85, 247, 0.3);
            color: ${isDark ? "#ffffff" : "#7c3aed"};
          }
          .footer {
            display: flex;
            align-items: center;
            justify-content: flex-end;
            gap: 6px;
            margin-top: 2px;
          }
          .primary-btn {
            background: linear-gradient(135deg, #a855f7, #6366f1);
            color: #ffffff;
            border: none;
            font-size: 10px;
            font-weight: 600;
            padding: 5px 10px;
            border-radius: 6px;
            cursor: pointer;
            box-shadow: 0 2px 6px rgba(168, 85, 247, 0.3);
            transition: opacity 0.15s ease, transform 0.15s ease;
          }
          .primary-btn:hover {
            opacity: 0.95;
            transform: translateY(-0.5px);
          }
          .primary-btn:active {
            transform: translateY(0);
          }
          .result-section {
            display: none;
            flex-direction: column;
            gap: 6px;
            padding-top: 8px;
            border-top: 1px solid ${isDark ? "rgba(255, 255, 255, 0.06)" : "rgba(0, 0, 0, 0.05)"};
          }
          .result-box {
            width: 100%;
            height: 80px;
            border-radius: 8px;
            padding: 6px 8px;
            font-size: 11px;
            font-family: inherit;
            resize: vertical;
            box-sizing: border-box;
            background: ${isDark ? "rgba(0, 0, 0, 0.2)" : "#f9fafb"};
            border: 1px solid ${isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.08)"};
            color: inherit;
            outline: none;
          }
          .action-btn-row {
            display: flex;
            align-items: center;
            justify-content: flex-end;
            gap: 6px;
          }
          .secondary-btn {
            background: transparent;
            border: 1px solid ${isDark ? "rgba(255, 255, 255, 0.15)" : "rgba(0, 0, 0, 0.15)"};
            color: inherit;
            font-size: 10px;
            font-weight: 500;
            padding: 4px 8px;
            border-radius: 6px;
            cursor: pointer;
            transition: all 0.15s ease;
          }
          .secondary-btn:hover {
            background: ${isDark ? "rgba(255, 255, 255, 0.05)" : "rgba(0, 0, 0, 0.03)"};
          }
        </style>

        <div class="capsule-card">
          <div class="header">
            <span class="title">✨ Visper Composer</span>
            <button class="close-btn" id="btn-close">❌</button>
          </div>
          <div class="body">
            <textarea id="prompt-input" placeholder="Ask Visper to draft, edit, or generate text..."></textarea>
            
            <div class="templates-row">
              <button class="template-btn" data-prompt="Rewrite this professionally: ">💼 Professional</button>
              <button class="template-btn" data-prompt="Rewrite this politely: ">😊 Polite</button>
              <button class="template-btn" data-prompt="Make this casual and engaging: ">🔥 Casual</button>
              <button class="template-btn" data-prompt="Summarize this in a short sentence: ">📝 Summarize</button>
            </div>

            <div class="footer">
              <button class="primary-btn" id="btn-generate">Generate</button>
            </div>

            <div class="result-section" id="res-section">
              <textarea class="result-box" id="result-text" placeholder="Drafting..."></textarea>
              <div class="action-btn-row">
                <button class="secondary-btn" id="btn-discard">Discard</button>
                <button class="secondary-btn" id="btn-insert-cursor">Insert at Cursor</button>
                <button class="primary-btn" id="btn-replace">Replace Text</button>
              </div>
            </div>
          </div>
        </div>
      `;

      // Get element refs inside Shadow DOM
      const btnClose = shadow.getElementById("btn-close");
      const btnGenerate = shadow.getElementById("btn-generate") as HTMLButtonElement;
      const btnDiscard = shadow.getElementById("btn-discard");
      const btnInsertCursor = shadow.getElementById("btn-insert-cursor");
      const btnReplace = shadow.getElementById("btn-replace");
      const promptInput = shadow.getElementById("prompt-input") as HTMLTextAreaElement;
      const resSection = shadow.getElementById("res-section") as HTMLDivElement;
      const resultText = shadow.getElementById("result-text") as HTMLTextAreaElement;
      const templateButtons = shadow.querySelectorAll(".template-btn");

      // Bind close action
      btnClose?.addEventListener("click", removeCapsule);

      // Handle template button clicks
      templateButtons.forEach((tBtn) => {
        tBtn.addEventListener("click", () => {
          const prefix = tBtn.getAttribute("data-prompt") || "";
          // Extract current input text context if exists
          let contextVal = "";
          if (activeInputElement) {
            contextVal = (activeInputElement as HTMLInputElement).value || activeInputElement.innerText || "";
          }
          promptInput.value = prefix + contextVal;
          promptInput.focus();
        });
      });

      // Stream Listener specifically for inline-composer target
      const inlineStreamListener = (message: any) => {
        if (message.target !== "inline-composer") return;

        if (message.type === "STREAM_CHUNK" && message.text) {
          activeStreamChunks += message.text;
          resultText.value = activeStreamChunks;
          
          // Auto scroll to bottom of result textarea
          resultText.scrollTop = resultText.scrollHeight;
        } else if (message.type === "STREAM_COMPLETE") {
          chrome.runtime.onMessage.removeListener(inlineStreamListener);
          btnGenerate.disabled = false;
          btnGenerate.textContent = "Regenerate";
        } else if (message.type === "STREAM_ERROR") {
          chrome.runtime.onMessage.removeListener(inlineStreamListener);
          resultText.value = activeStreamChunks + `\n\n[Error: ${message.error}]`;
          btnGenerate.disabled = false;
          btnGenerate.textContent = "Retry";
        }
      };

      // Bind generate button action
      btnGenerate?.addEventListener("click", async () => {
        const instruction = promptInput.value.trim();
        if (!instruction) return;

        // Reset buffer and prepare result layout
        activeStreamChunks = "";
        resultText.value = "Generating draft...";
        resSection.style.display = "flex";
        btnGenerate.disabled = true;
        btnGenerate.textContent = "Writing...";

        // Extract context value
        let contextVal = "";
        if (activeInputElement) {
          contextVal = (activeInputElement as HTMLInputElement).value || activeInputElement.innerText || "";
        }

        // Formulate final LLM prompt instructions
        const finalPrompt = `You are a writing assistant. Take the user's instruction and generate/rewrite the text accordingly.
Instruction: "${instruction}"
Webpage textbox context (current content of input): "${contextVal}"
Output ONLY the generated or rewritten text. Do not write any intro, outro, explanations, or quotes. Output the clean result directly.`;

        // Listen for incoming stream chunks
        chrome.runtime.onMessage.addListener(inlineStreamListener);

        // Request service worker to stream inline generation
        chrome.runtime.sendMessage({
          type: "GENERATE_STREAM_INLINE",
          prompt: finalPrompt,
          history: [],
          model: activeModel,
          keys: apiKeys
        }).catch((err) => {
          chrome.runtime.onMessage.removeListener(inlineStreamListener);
          resultText.value = `Error initiating generation request: ${err.message}`;
          btnGenerate.disabled = false;
          btnGenerate.textContent = "Generate";
        });
      });

      // Bind result insertions
      btnDiscard?.addEventListener("click", () => {
        resSection.style.display = "none";
        resultText.value = "";
        activeStreamChunks = "";
        btnGenerate.textContent = "Generate";
      });

      btnInsertCursor?.addEventListener("click", () => {
        insertTextIntoInput(resultText.value, "insert");
        removeCapsule();
      });

      btnReplace?.addEventListener("click", () => {
        insertTextIntoInput(resultText.value, "replace");
        removeCapsule();
      });
    });
  };

  // Close capsule when clicking anywhere else on page
  document.addEventListener("mousedown", (e) => {
    if (!capsuleHost || !activeInputElement) return;

    const clickedEl = e.target as Node;
    if (capsuleHost.contains(clickedEl) || activeInputElement.contains(clickedEl)) {
      return;
    }
    
    // Check if clicked inside the capsule shadow root content using path elements
    const path = e.composedPath();
    if (path.includes(capsuleHost)) return;

    // Small delay to allow buttons inside the shadow DOM to trigger before removal
    setTimeout(removeCapsule, 150);
  });
})();
