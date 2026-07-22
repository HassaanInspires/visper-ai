// Visper AI: Task Mode Dispatcher & Prompt Router
// Automatically detects active task mode and injects mode-specific system instructions.

export type TaskMode = "auto" | "chat" | "shopping" | "research" | "youtube" | "writer";

export interface TaskModeContext {
  activeMode: TaskMode;
  detectedMode: TaskMode;
  domain?: string;
}

/**
  * Auto-detects task mode based on URL, domain, and prompt intent
  */
export function detectTaskMode(url: string = "", prompt: string = ""): TaskMode {
  const lowerUrl = url.toLowerCase();
  const lowerPrompt = prompt.toLowerCase();

  // 1. YouTube Mode
  if (lowerUrl.includes("youtube.com/watch") || lowerUrl.includes("youtu.be")) {
    return "youtube";
  }

  // 2. Shopping Mode
  const shoppingDomains = ["trueawrah.com", "daraz.pk", "amazon.", "ebay.", "shopify", "etsy.", "aliexpress."];
  const shoppingKeywords = ["buy", "add to cart", "size m", "size l", "price", "checkout", "order", "product"];
  if (shoppingDomains.some(d => lowerUrl.includes(d)) || shoppingKeywords.some(k => lowerPrompt.includes(k))) {
    return "shopping";
  }

  // 3. Research Mode
  const researchKeywords = ["compare", "vs", "top 10", "best", "list websites", "find sellers", "research"];
  if (lowerUrl.includes("google.com/search") || lowerUrl.includes("bing.com/search") || researchKeywords.some(k => lowerPrompt.includes(k))) {
    return "research";
  }

  // 4. Writer Mode
  const writerDomains = ["mail.google.com", "outlook.live.com", "linkedin.com", "twitter.com", "x.com"];
  const writerKeywords = ["draft email", "reply to", "rewrite", "summarize text", "cover letter"];
  if (writerDomains.some(d => lowerUrl.includes(d)) || writerKeywords.some(k => lowerPrompt.includes(k))) {
    return "writer";
  }

  return "chat";
}

/**
  * Injects mode-specific system instructions
  */
export function getModeSystemInstructions(mode: TaskMode): string {
  switch (mode) {
    case "shopping":
      return `
MODE: SHOPPING & CART AUTOMATION MODE
- You are operating in E-Commerce Shopping Mode.
- To add items to cart, select sizes, or checkout, output structured e-commerce tool JSON blocks.
- Prefer direct variant selection and add-to-cart actions. Do NOT navigate in loops.
`;

    case "research":
      return `
MODE: MULTI-SITE RESEARCH & MATRIX MODE
- You are operating in Deep Research Mode.
- Present competitive findings in clean Markdown Comparison Tables using GFM table format (| Header 1 | Header 2 |).
- Provide concise, cite-backed bullet points and avoid opening unnecessary browser tabs.
`;

    case "youtube":
      return `
MODE: YOUTUBE COPILOT MODE
- You are operating in YouTube Intelligence Mode.
- Answer questions directly using the video transcript or description provided in context.
- Use clickable timestamp links (e.g. [02:15]) when citing specific video segments.
`;

    case "writer":
      return `
MODE: SMART WRITER & FORM ASSISTANT MODE
- You are operating in Writing Assistant Mode.
- Draft clear, well-structured emails, social posts, or form answers matching the requested tone.
`;

    default:
      return "";
  }
}
