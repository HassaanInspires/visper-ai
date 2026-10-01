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

// Word-boundary token matcher to prevent false-positive substring collisions (e.g. "opacity" matching "city")
export function hasWordMatch(haystack: string, needle: string): boolean {
  if (!haystack || !needle) return false;
  const h = haystack.toLowerCase().replace(/[-_./:]/g, " ").replace(/\s+/g, " ");
  const n = needle.toLowerCase().replace(/[-_./:]/g, " ").trim();
  if (h === n) return true;
  const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(^|\\s)${escaped}(\\s|$)`, "i");
  return regex.test(h);
}

// Universal resolver that locates the real interactable input/textarea/select from labels, wrappers, or sibling containers
// Handles Next.js, React 18/19, Tailwind, Shopify, and custom SPA form structures
export function resolveToInteractiveInput(el: HTMLElement): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    return el;
  }

  // 1. If it's a <label>
  if (el.tagName === "LABEL") {
    const htmlFor = (el as HTMLLabelElement).htmlFor;
    if (htmlFor) {
      const linked = document.getElementById(htmlFor);
      if (linked && (linked instanceof HTMLInputElement || linked instanceof HTMLTextAreaElement || linked instanceof HTMLSelectElement)) {
        return linked;
      }
    }
    // Child input
    const child = el.querySelector("input:not([type='hidden']), textarea, select");
    if (child) return child as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

    // Sibling input in same parent container (classic Next.js: <div class="space-y-1"><label>Name</label><input /></div>)
    const parent = el.parentElement;
    if (parent) {
      const siblingInput = parent.querySelector("input:not([type='hidden']), textarea, select");
      if (siblingInput) return siblingInput as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    }

    // Following sibling elements
    let next = el.nextElementSibling;
    while (next) {
      if (next instanceof HTMLInputElement || next instanceof HTMLTextAreaElement || next instanceof HTMLSelectElement) {
        return next;
      }
      const innerInput = next.querySelector("input:not([type='hidden']), textarea, select");
      if (innerInput) return innerInput as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      next = next.nextElementSibling;
    }
  }

  // 2. If it's a container element (DIV, SPAN, P, SECTION, FIELDSET, LI, etc.)
  const childInput = el.querySelector("input:not([type='hidden']), textarea, select");
  if (childInput) return childInput as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

  const container = el.closest("div, fieldset, li, tr, form");
  if (container) {
    const containerInput = container.querySelector("input:not([type='hidden']), textarea, select");
    if (containerInput) return containerInput as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  }

  if (el.parentElement) {
    const parentInput = el.parentElement.querySelector("input:not([type='hidden']), textarea, select");
    if (parentInput) return parentInput as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  }

  let next = el.nextElementSibling;
  while (next) {
    if (next instanceof HTMLInputElement || next instanceof HTMLTextAreaElement || next instanceof HTMLSelectElement) {
      return next;
    }
    const innerInput = next.querySelector("input:not([type='hidden']), textarea, select");
    if (innerInput) return innerInput as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    next = next.nextElementSibling;
  }

  return null;
}

// Helper to safely insert or replace text in any input, textarea, or contenteditable editor
// Guaranteed 0% chance of "Illegal invocation" due to strict V8 brand checks
export function safeInsertTextIntoElement(el: HTMLElement, text: string, mode: "replace" | "insert" = "insert") {
  // If element is contentEditable, handle directly
  if (el.isContentEditable) {
    el.focus();
    if (mode === "replace") {
      const sel = window.getSelection();
      if (sel) {
        const range = document.createRange();
        range.selectNodeContents(el);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
    const success = document.execCommand("insertText", false, text);
    if (!success) {
      if (mode === "replace") {
        el.innerText = text;
      } else {
        el.innerText += text;
      }
    }
    el.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    el.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    return;
  }

  const inputEl = resolveToInteractiveInput(el);
  if (!inputEl) {
    throw new Error(`Target element <${el.tagName}> has no interactive input field associated with it.`);
  }

  // Handle HTMLSelectElement explicitly (dropdown menus)
  if (inputEl instanceof HTMLSelectElement || inputEl.tagName === "SELECT") {
    const selectEl = inputEl as HTMLSelectElement;
    selectEl.focus();
    const target = text.trim().toLowerCase();
    let matchedOption: HTMLOptionElement | null = null;
    const options = Array.from(selectEl.options);

    // 1. Exact text or value match
    for (const opt of options) {
      const val = (opt.value || "").trim().toLowerCase();
      const txt = (opt.text || "").trim().toLowerCase();
      if (val === target || txt === target) {
        matchedOption = opt;
        break;
      }
    }

    // 2. Word-boundary match on option text
    if (!matchedOption) {
      for (const opt of options) {
        const val = (opt.value || "").trim().toLowerCase();
        const txt = (opt.text || "").trim().toLowerCase();
        if (hasWordMatch(txt, target) || (val.length >= 3 && hasWordMatch(val, target))) {
          matchedOption = opt;
          break;
        }
      }
    }

    // 3. Substring match on option text or substantial value (>= 4 chars)
    if (!matchedOption) {
      for (const opt of options) {
        const val = (opt.value || "").trim().toLowerCase();
        const txt = (opt.text || "").trim().toLowerCase();
        if (txt && (txt.includes(target) || (target.length >= 5 && target.includes(txt)))) {
          matchedOption = opt;
          break;
        }
        if (val.length >= 4 && (val.includes(target) || target.includes(val))) {
          matchedOption = opt;
          break;
        }
      }
    }

    const proto = window.HTMLSelectElement?.prototype;
    const setNativeValue = proto ? Object.getOwnPropertyDescriptor(proto, "value")?.set : null;
    const finalVal = matchedOption ? matchedOption.value : text;

    if (matchedOption) {
      matchedOption.selected = true;
    }

    if (setNativeValue) {
      setNativeValue.call(selectEl, finalVal);
    } else {
      selectEl.value = finalVal;
    }

    selectEl.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    selectEl.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    selectEl.dispatchEvent(new Event("blur", { bubbles: true, composed: true }));
    return;
  }

  inputEl.focus();

  if (mode === "replace" && typeof (inputEl as any).select === "function") {
    try { (inputEl as any).select(); } catch {}
  }

  let success = false;
  try {
    success = document.execCommand("insertText", false, text);
  } catch {}

  if (!success) {
    const isTextArea = inputEl instanceof HTMLTextAreaElement || inputEl.tagName === "TEXTAREA";
    const proto = isTextArea 
      ? window.HTMLTextAreaElement?.prototype 
      : window.HTMLInputElement?.prototype;
    const setNativeValue = proto ? Object.getOwnPropertyDescriptor(proto, "value")?.set : null;

    if (mode === "replace") {
      if (setNativeValue) {
        setNativeValue.call(inputEl, text);
      } else {
        (inputEl as HTMLInputElement).value = text;
      }
    } else {
      const val = (inputEl as HTMLInputElement).value || "";
      const start = (inputEl as HTMLInputElement).selectionStart ?? val.length;
      const end = (inputEl as HTMLInputElement).selectionEnd ?? val.length;
      const newVal = val.substring(0, start) + text + val.substring(end);
      if (setNativeValue) {
        setNativeValue.call(inputEl, newVal);
      } else {
        (inputEl as HTMLInputElement).value = newVal;
      }
    }
  }

  inputEl.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  inputEl.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  inputEl.dispatchEvent(new Event("blur", { bubbles: true, composed: true }));
}

export interface FormFieldInfo {
  index: number;
  label: string;
  name: string;
  id: string;
  type: string;
  placeholder: string;
  autocomplete: string;
  isPromo: boolean;
  currentValue: string;
  options?: string[];
}

// Scans active visible form fields on current page/step to prevent agent hallucination
export function extractVisibleFormFields(): FormFieldInfo[] {
  try {
    const inputs = Array.from(document.querySelectorAll<HTMLElement>("input, textarea, select"));
    const fields: FormFieldInfo[] = [];
    let count = 0;

    for (const el of inputs) {
      if (!isElementVisible(el)) continue;
      const type = (el.getAttribute("type") || el.tagName.toLowerCase()).toLowerCase();
      if (type === "hidden" || type === "submit" || type === "button" || type === "image" || type === "reset") {
        continue;
      }

      count++;
      const name = el.getAttribute("name") || "";
      const id = el.id || "";
      const placeholder = el.getAttribute("placeholder") || "";
      const autocomplete = el.getAttribute("autocomplete") || "";
      const aria = el.getAttribute("aria-label") || "";

      // Resolve human label
      let label = aria || placeholder;
      if (!label && id) {
        const lbl = document.querySelector<HTMLLabelElement>(`label[for="${id}"]`);
        if (lbl) label = lbl.textContent?.trim() || "";
      }
      if (!label) {
        const parentLbl = el.closest("label");
        if (parentLbl) label = parentLbl.textContent?.trim() || "";
      }
      if (!label) {
        const container = el.closest("div, fieldset, li, tr, form");
        if (container) {
          const cLbl = container.querySelector("label, .label, [class*='label']");
          if (cLbl) label = cLbl.textContent?.trim() || "";
        }
      }
      if (!label && el.previousElementSibling) {
        const prevText = el.previousElementSibling.textContent?.trim();
        if (prevText && prevText.length < 50) label = prevText;
      }
      if (!label) {
        label = name;
      }

      label = label.replace(/\s+/g, " ").trim();

      const isPromo = (
        hasWordMatch(name, "promo") || hasWordMatch(name, "coupon") || hasWordMatch(name, "discount") || hasWordMatch(name, "voucher") ||
        hasWordMatch(id, "promo") || hasWordMatch(id, "coupon") || hasWordMatch(id, "discount") || hasWordMatch(id, "voucher") ||
        hasWordMatch(label, "promo") || hasWordMatch(label, "coupon") || hasWordMatch(label, "discount") || hasWordMatch(label, "voucher") ||
        hasWordMatch(placeholder, "promo") || hasWordMatch(placeholder, "coupon") || hasWordMatch(placeholder, "discount") || hasWordMatch(placeholder, "voucher")
      );

      const currentValue = (el as HTMLInputElement).value || "";

      let optionsList: string[] | undefined = undefined;
      if (el instanceof HTMLSelectElement || el.tagName === "SELECT" || type === "select") {
        const optElements = Array.from((el as HTMLSelectElement).options || []);
        optionsList = optElements
          .map(opt => opt.text?.trim() || opt.value?.trim())
          .filter(Boolean)
          .slice(0, 30);
      }

      fields.push({
        index: count,
        label,
        name,
        id,
        type,
        placeholder,
        autocomplete,
        isPromo,
        currentValue,
        options: optionsList
      });
    }

    return fields;
  } catch (e) {
    console.warn("Visper: Failed to extract visible form fields:", e);
    return [];
  }
}

// Helper to extract clean text content of the entire webpage body
// Removes navigation panels, menus, scripts, styles, footers, etc. to yield pure content
function extractCleanPageText(): string {
  try {
    const mainContentEl = document.querySelector("main, article, [role='main'], #content, .main-content");
    const rootEl = (mainContentEl || document.body).cloneNode(true) as HTMLElement;
    
    // Remove heavy non-content nodes
    const elementsToRemove = rootEl.querySelectorAll(
      "script, style, iframe, noscript, svg, header, footer, nav, aside, .header, .footer, .nav, .menu, .sidebar, .ad, [aria-hidden='true']"
    );
    elementsToRemove.forEach(el => el.remove());
    
    // Traverse remaining text nodes with Set for O(1) deduplication
    const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT);
    const textNodes: string[] = [];
    const seen = new Set<string>();
    let node;
    while ((node = walker.nextNode())) {
      const text = node.textContent?.trim().replace(/\s+/g, " ") || "";
      // Keep meaningful lines of text (length > 3) and avoid duplicates using Set
      if (text.length > 3 && !seen.has(text)) {
        seen.add(text);
        textNodes.push(text);
        if (textNodes.length >= 1000) break;
      }
    }
    
    let resultText = textNodes.join("\n");
    const formFields = extractVisibleFormFields();
    if (formFields.length > 0) {
      const fieldLines = formFields.map(f => {
        const promoTag = f.isPromo ? " [DISCOUNT/PROMO CODE]" : "";
        const optionsTag = (f.options && f.options.length > 0) 
          ? ` | Options: [${f.options.slice(0, 10).map(o => `"${o}"`).join(", ")}${f.options.length > 10 ? "..." : ""}]` 
          : "";
        return `- [Field #${f.index}] Label: "${f.label}" | Type: ${f.type} | Name: "${f.name}"${promoTag}${optionsTag}${f.currentValue ? ` | Current: "${f.currentValue}"` : ""}`;
      });
      resultText += `\n\n--- Active Form Fields on Current Page ---\n${fieldLines.join("\n")}\n--- End Form Fields ---`;
    }

    return resultText;
  } catch (e) {
    console.warn("Failed to extract clean page text:", e);
    return (document.body?.innerText || "").slice(0, 50000);
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

const FIELD_SYNONYMS: Record<string, string[]> = {
  "first name": ["first name", "firstname", "first_name", "fname", "given name", "given-name", "forename"],
  "last name": ["last name", "lastname", "last_name", "lname", "family name", "family-name", "surname"],
  "email": ["email", "e-mail", "email address", "email_address", "user_email"],
  "phone": ["phone", "phonenumber", "phone_number", "mobile", "mobile number", "tel", "telephone", "cell", "contact number"],
  "whatsapp": ["whatsapp", "wa_number", "wa", "whatsapp number"],
  "address": ["address", "street", "street address", "street_address", "address1", "address_1", "line1"],
  "city": ["city", "town", "locality"],
  "state": ["state", "province", "region", "territory", "subdivision"],
  "zip": ["zip", "zipcode", "zip_code", "postal", "postalcode", "postal_code", "pincode", "postcode"],
  "country": ["country", "nation", "country_code"],
  "promo": ["promo", "promo code", "promocode", "coupon", "coupon code", "discount", "discount code", "voucher", "voucher code", "gift card"]
};

// 2. Semantic Element Matcher: Resolves elements on legacy pages without formal WebMCP integration
export function findElementSemantically(tag?: string, text?: string, selector?: string): HTMLElement | null {
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

  // Strategy A2: YouTube Direct Video Matcher (for "play first video", "first video", "1st video")
  const isFirstVideoQuery = targetText === "first video" || targetText === "play first video" || targetText === "1st video" || targetText === "open first video" || targetText === "top video" || targetText.includes("first video") || targetText.includes("1st video");
  if (isFirstVideoQuery && (typeof window !== "undefined" && (window.location.hostname.includes("youtube.com") || window.location.href.includes("youtube.com")))) {
    const firstVideoEl = document.querySelector<HTMLElement>("ytd-video-renderer a#video-title, ytd-rich-item-renderer a#video-title, ytd-grid-video-renderer a#video-title, a#video-title");
    if (firstVideoEl && isElementVisible(firstVideoEl)) return firstVideoEl;
  }

  // Strategy B: Match tags and compute semantic relevance score
  const allTags = ["BUTTON", "INPUT", "A", "LABEL", "TEXTAREA", "SELECT", "DIV", "SPAN"];
  const tagsToSearch = targetTag ? [targetTag, ...allTags.filter(t => t !== targetTag)] : allTags;
  const candidates: { el: HTMLElement; score: number }[] = [];

  const isAddToCartQuery = targetText.includes("add to cart") || targetText.includes("add to bag") || targetText.includes("buy now") || targetText === "cart";
  const isSizeQuery = targetText === "s" || targetText === "m" || targetText === "l" || targetText === "xl" || targetText === "xxl" || targetText === "small" || targetText === "medium" || targetText === "large" || targetText === "extra large";

  const isPromoQuery = (
    hasWordMatch(targetText, "promo") || hasWordMatch(targetText, "coupon") || 
    hasWordMatch(targetText, "discount") || hasWordMatch(targetText, "voucher") ||
    hasWordMatch(targetText, "gift")
  );

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
      const elAutocomplete = el.getAttribute("autocomplete")?.trim().toLowerCase() || "";

      // Home & Logo Protection: Strictly penalize home/logo anchors if user query is not explicitly asking for home/logo
      const isHomeOrLogoElement = (
        elId === "logo" || elId === "logo-icon" ||
        elClass.includes("logo") || elAria.includes("youtube home") || elAria.includes("homepage") ||
        (t === "A" && ((el as HTMLAnchorElement).pathname === "/" || (el as HTMLAnchorElement).getAttribute("href") === "/" || (el as HTMLAnchorElement).getAttribute("href") === "https://www.youtube.com/"))
      );
      const isExplicitHomeQuery = hasWordMatch(targetText, "home") || hasWordMatch(targetText, "logo") || hasWordMatch(targetText, "main");
      if (isHomeOrLogoElement && !isExplicitHomeQuery) {
        score -= 600;
      }

      // YouTube Video Title Booster
      if (typeof window !== "undefined" && window.location.hostname.includes("youtube.com")) {
        if (elId === "video-title" || el.closest("ytd-video-renderer, ytd-rich-item-renderer, ytd-grid-video-renderer")) {
          score += 60;
        }
      }

      // Promo/Discount Blacklist Protection: Strictly penalize promo boxes if user query is not asking for promo
      const isPromoElement = (
        hasWordMatch(elName, "promo") || hasWordMatch(elName, "coupon") || hasWordMatch(elName, "discount") || hasWordMatch(elName, "voucher") ||
        hasWordMatch(elId, "promo") || hasWordMatch(elId, "coupon") || hasWordMatch(elId, "discount") || hasWordMatch(elId, "voucher") ||
        hasWordMatch(elPlaceholder, "promo") || hasWordMatch(elPlaceholder, "coupon") || hasWordMatch(elPlaceholder, "discount") || hasWordMatch(elPlaceholder, "voucher") ||
        hasWordMatch(elAria, "promo") || hasWordMatch(elAria, "coupon") || hasWordMatch(elAria, "discount") || hasWordMatch(elAria, "voucher") ||
        hasWordMatch(elClass, "promo") || hasWordMatch(elClass, "coupon") || hasWordMatch(elClass, "discount") || hasWordMatch(elClass, "voucher")
      );

      if (isPromoElement && !isPromoQuery) {
        score -= 500;
      }

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
        // 1. Direct Content Match & Substring Inclusions
        if (rawText === targetText) {
          score += 150;
        } else if (rawText && targetText && (rawText.length >= 6 && targetText.includes(rawText))) {
          // Reverse substring match: element text is contained within query (e.g. element has "Men's Awrah Swim Shorts", query has "Men's Awrah Swim Shorts (Dual-Layer, Quick Dry) by Avicyn")
          score += 140;
        } else if (rawText && targetText && (targetText.length >= 6 && rawText.includes(targetText))) {
          // Forward substring match
          score += 130;
        } else if (hasWordMatch(rawText, targetText) || hasWordMatch(targetText, rawText)) {
          score += 80;
        }

        // 1b. Token Overlap / Jaccard similarity for long titles or queries with extra descriptors
        const targetTokens = targetText.split(/[\s,./()_—–-]+/).filter(tok => tok.length > 2);
        const rawTokens = rawText.split(/[\s,./()_—–-]+/).filter(tok => tok.length > 2);
        if (targetTokens.length > 0 && rawTokens.length > 0) {
          let matchCount = 0;
          for (const tok of rawTokens) {
            if (targetTokens.includes(tok)) matchCount++;
          }
          const tokenCoverage = matchCount / rawTokens.length;
          const targetCoverage = matchCount / targetTokens.length;
          if (matchCount >= 2 && (tokenCoverage >= 0.4 || targetCoverage >= 0.4)) {
            score += Math.round(matchCount * 25 * Math.max(tokenCoverage, targetCoverage));
          }
        }

        // Special check for <select> options
        if (t === "SELECT" || el.tagName === "SELECT") {
          const selectEl = el as HTMLSelectElement;
          for (const opt of Array.from(selectEl.options)) {
            const optVal = (opt.value || "").trim().toLowerCase();
            const optTxt = (opt.text || "").trim().toLowerCase();
            if (optVal === targetText || optTxt === targetText) {
              score += 170;
              break;
            } else if (optTxt && targetText && (optTxt.includes(targetText) || targetText.includes(optTxt))) {
              score += 130;
              break;
            }
          }
        }

        // 2. Aria-Label match
        if (elAria === targetText) score += 130;
        else if (hasWordMatch(elAria, targetText)) score += 65;

        // 3. Input value & placeholder match
        if (elValue === targetText) score += 110;
        else if (hasWordMatch(elValue, targetText)) score += 55;
        if (elPlaceholder === targetText) score += 110;
        else if (hasWordMatch(elPlaceholder, targetText)) score += 55;

        // 4. Name attribute match
        if (elName === targetText) score += 100;
        else if (hasWordMatch(elName, targetText)) score += 50;

        // 5. Element details (Id/Class) — using word-boundary match to prevent "opacity" matching "city"
        if (elId && (elId === targetText || hasWordMatch(elId, targetText))) score += 40;
        if (elClass && hasWordMatch(elClass, targetText)) score += 20;

        // 6. Autocomplete attribute match (W3C standard)
        if (elAutocomplete && (elAutocomplete === targetText || hasWordMatch(elAutocomplete, targetText))) {
          score += 170;
        }

        // 7. Semantic Synonyms Matching (maps "First name" to firstName, fname, given-name, etc.)
        for (const [canonical, syns] of Object.entries(FIELD_SYNONYMS)) {
          const isTargetThisField = targetText === canonical || syns.some(s => hasWordMatch(targetText, s));
          if (isTargetThisField) {
            const isElementMatch = (
              syns.some(s => hasWordMatch(elName, s)) ||
              syns.some(s => hasWordMatch(elId, s)) ||
              syns.some(s => hasWordMatch(elPlaceholder, s)) ||
              syns.some(s => hasWordMatch(elAria, s)) ||
              syns.some(s => hasWordMatch(elAutocomplete, s))
            );
            if (isElementMatch) {
              score += 180;
              break;
            }
          }
        }

        // 8. Label-Association Matches (Critical for Form Fields & Radio Pills)
        if (t === "INPUT" || t === "TEXTAREA" || t === "SELECT" || t === "LABEL") {
          if (el.id) {
            const labelEl = document.querySelector(`label[for="${el.id}"]`);
            if (labelEl) {
              const labelText = labelEl.textContent?.trim().toLowerCase() || "";
              if (labelText === targetText) score += 160;
              else if (hasWordMatch(labelText, targetText)) score += 80;
            }
          }

          const parentLabel = el.closest("label");
          if (parentLabel) {
            const labelText = parentLabel.textContent?.trim().toLowerCase() || "";
            if (labelText === targetText) score += 150;
            else if (hasWordMatch(labelText, targetText)) score += 75;
          }

          // Container-level label matching for Next.js / Tailwind sibling inputs
          const container = el.closest("div, fieldset, li, tr, form");
          if (container) {
            const containerLabel = container.querySelector("label, .label, [class*='label']");
            if (containerLabel && containerLabel !== el) {
              const lblText = containerLabel.textContent?.trim().toLowerCase() || "";
              if (lblText === targetText) score += 150;
              else if (hasWordMatch(lblText, targetText)) score += 75;
            }
          }

          // Preceding sibling label
          let prev = el.previousElementSibling;
          while (prev) {
            const prevText = prev.textContent?.trim().toLowerCase() || "";
            if (prevText === targetText) { score += 150; break; }
            else if (hasWordMatch(prevText, targetText)) { score += 75; break; }
            prev = prev.previousElementSibling;
          }
        }
      }

      if (score > 0) {
        candidates.push({ el, score: score * tagWeightMultiplier });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  // Strict confidence threshold: If target text was specified, candidate MUST score at least 70
  // to avoid false positives (e.g. clicking YouTube logo/home when video title isn't found).
  const MIN_MATCH_SCORE = targetText ? 70 : 1;

  for (const candidate of candidates) {
    if (candidate.score < MIN_MATCH_SCORE) continue;
    if (targetTag === "INPUT" || targetTag === "TEXTAREA" || targetTag === "SELECT") {
      const resolved = resolveToInteractiveInput(candidate.el);
      if (resolved && isElementVisible(resolved)) {
        return resolved;
      }
    } else if (targetTag === "A") {
      if (candidate.el.tagName === "A") return candidate.el;
      const childLink = candidate.el.querySelector<HTMLAnchorElement>("a[href]");
      if (childLink && isElementVisible(childLink)) return childLink;
      const parentLink = candidate.el.closest<HTMLAnchorElement>("a[href]");
      if (parentLink && isElementVisible(parentLink)) return parentLink;
      return candidate.el;
    } else {
      // If tag is generic/clickable container (DIV, ARTICLE, LI, SPAN), resolve to child anchor or button
      if (candidate.el.tagName !== "BUTTON" && candidate.el.tagName !== "A" && candidate.el.tagName !== "INPUT" && candidate.el.tagName !== "SELECT") {
        const childAction = candidate.el.querySelector<HTMLElement>("a[href], button");
        if (childAction && isElementVisible(childAction)) {
          return childAction;
        }
        const parentAction = candidate.el.closest<HTMLElement>("a[href], button");
        if (parentAction && isElementVisible(parentAction)) {
          return parentAction;
        }
      }
      return candidate.el;
    }
  }

  return candidates.length > 0 && candidates[0].score >= MIN_MATCH_SCORE ? candidates[0].el : null;
}

// 3. Asynchronous Polling Matcher for dynamic SPAs (YouTube, React, Next.js)
export async function waitForElementSemantically(
  tag?: string,
  text?: string,
  selector?: string,
  timeoutMs: number = 3000
): Promise<HTMLElement | null> {
  const start = Date.now();
  
  // Fast path: Immediate lookup
  const immediate = findElementSemantically(tag, text, selector);
  if (immediate) return immediate;

  // Slow path: Polling up to timeoutMs
  return new Promise<HTMLElement | null>((resolve) => {
    let resolved = false;

    const cleanup = () => {
      resolved = true;
      clearInterval(interval);
      if (observer) observer.disconnect();
    };

    const check = () => {
      if (resolved) return;
      const el = findElementSemantically(tag, text, selector);
      if (el) {
        cleanup();
        resolve(el);
      } else if (Date.now() - start >= timeoutMs) {
        cleanup();
        resolve(null);
      }
    };

    const interval = setInterval(check, 150);

    let observer: MutationObserver | null = null;
    if (typeof MutationObserver !== "undefined" && typeof document !== "undefined" && document.body) {
      observer = new MutationObserver(() => {
        check();
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }

    // Safety timeout
    setTimeout(() => {
      if (!resolved) {
        cleanup();
        resolve(findElementSemantically(tag, text, selector));
      }
    }, timeoutMs + 50);
  });
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

export async function scrapeYoutubeDomTranscript(): Promise<{ text: string; start: number; duration: number }[] | null> {
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
        // Poll up to 2,000ms for YouTube custom web components to render segments
        for (let attempt = 0; attempt < 10; attempt++) {
          await new Promise(r => setTimeout(r, 200));
          segments = Array.from(document.querySelectorAll("ytd-transcript-segment-renderer, .ytd-transcript-segment-renderer"));
          if (segments.length > 0) break;
        }
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
      const activeEl = document.activeElement as HTMLElement;
      if (activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA" || activeEl.isContentEditable)) {
        safeInsertTextIntoElement(activeEl, message.text || "", message.mode || "insert");
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

    if (message.action === "get_youtube_transcript" || message.action === "youtube_transcript") {
      (async () => {
        try {
          const isWatchPage = (typeof window !== "undefined") && (
            (window.location.host.includes("youtube.com") && window.location.pathname.includes("/watch")) ||
            window.location.host.includes("youtu.be")
          );
          let videoId = "";
          try {
            videoId = new URL(window.location.href).searchParams.get("v") || "";
          } catch {}

          if (!isWatchPage || !videoId) {
            sendResponse({
              success: false,
              error: `Not on a YouTube video watch page (current page: ${window.location.pathname}). Please open a video first.`
            });
            return;
          }

          let transcript: { text: string; start: number; duration: number }[] | null = null;
          let videoTitle = document.title;

          const titleEl = document.querySelector("h1.ytd-watch-metadata yt-formatted-string, #title h1, h1.title");
          if (titleEl?.textContent?.trim()) videoTitle = titleEl.textContent.trim();

          const playerResponse = await getYoutubePlayerResponse();
          if (playerResponse) {
            if (playerResponse.videoDetails?.title) videoTitle = playerResponse.videoDetails.title;
            if (playerResponse.videoDetails?.videoId) videoId = playerResponse.videoDetails.videoId;
            const captionTracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
            if (captionTracks.length > 0) {
              const candidateTracks = [
                ...captionTracks.filter((t: any) => t.languageCode === "en" || t.languageCode === "ur" || t.languageCode === "hi"),
                ...captionTracks
              ];
              for (const track of candidateTracks) {
                if (!track?.baseUrl) continue;
                try {
                  const res = await fetch(track.baseUrl);
                  if (!res.ok) continue;
                  const rawText = await res.text();
                  if (rawText.includes("<text")) {
                    const parser = new DOMParser();
                    const xmlDoc = parser.parseFromString(rawText, "text/xml");
                    const textNodes = xmlDoc.getElementsByTagName("text");
                    const parsedSegs: { text: string; start: number; duration: number }[] = [];
                    for (let i = 0; i < textNodes.length; i++) {
                      const node = textNodes[i];
                      const text = (node.textContent || "")
                        .replace(/&amp;/g, "&")
                        .replace(/&lt;/g, "<")
                        .replace(/&gt;/g, ">")
                        .replace(/&quot;/g, '"')
                        .replace(/&#39;/g, "'")
                        .trim();
                      const start = parseFloat(node.getAttribute("start") || "0");
                      const duration = parseFloat(node.getAttribute("dur") || "0");
                      if (text) parsedSegs.push({ text, start, duration });
                    }
                    if (parsedSegs.length > 0) {
                      transcript = parsedSegs;
                      break;
                    }
                  }
                } catch {}
              }
            }
          }

          if (!transcript || transcript.length === 0) {
            transcript = await scrapeYoutubeDomTranscript();
          }

          if (transcript && transcript.length > 0) {
            const formatted = transcript.slice(0, 300).map(t => {
              const m = Math.floor(t.start / 60);
              const s = Math.floor(t.start % 60);
              const stamp = `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
              return `[${stamp}] ${t.text}`;
            }).join("\n");

            sendResponse({
              success: true,
              message: `Retrieved ${transcript.length} transcript segments for "${videoTitle}".`,
              title: videoTitle,
              videoId,
              text: `--- YouTube Video Transcript (${videoTitle}) ---\n${formatted}\n--- End Transcript ---`,
              transcript
            });
          } else {
            sendResponse({
              success: false,
              error: `No captions or transcript available for this video ("${videoTitle}").`
            });
          }
        } catch (err: any) {
          sendResponse({ success: false, error: `Transcript extraction failed: ${err.message}` });
        }
      })();
      return true;
    }

    if (message.action === "autofill_form") {
      try {
        const fields = message.fields || {};
        const results: { field: string; status: "filled" | "skipped" | "failed"; message: string }[] = [];
        let filledCount = 0;

        for (const [rawKey, rawVal] of Object.entries(fields)) {
          if (!rawVal || typeof rawVal !== "string") continue;
          const targetLabel = rawKey
            .replace(/([A-Z])/g, " $1")
            .replace(/[-_]/g, " ")
            .trim();
          
          let matchedEl = findElementSemantically("INPUT", targetLabel);
          if (!matchedEl) {
            matchedEl = findElementSemantically("SELECT", targetLabel);
          }
          if (!matchedEl) {
            matchedEl = findElementSemantically(undefined, targetLabel);
          }

          if (matchedEl) {
            try {
              safeInsertTextIntoElement(matchedEl, rawVal, "replace");
              filledCount++;
              results.push({ field: rawKey, status: "filled", message: `Filled "${rawKey}" with "${rawVal}"` });
            } catch (err: any) {
              results.push({ field: rawKey, status: "failed", message: `Failed "${rawKey}": ${err.message}` });
            }
          } else {
            results.push({ field: rawKey, status: "skipped", message: `Field "${rawKey}" not found on current form step.` });
          }
        }

        sendResponse({
          success: true,
          message: `Autofilled ${filledCount} of ${Object.keys(fields).length} field(s) successfully.`,
          details: results
        });
      } catch (e: any) {
        sendResponse({ success: false, error: `Autofill execution failed: ${e.message}` });
      }
      return false;
    }

    (async () => {
      try {
        const element = await waitForElementSemantically(message.tag, message.text, message.selector, 3000);
        if (!element) {
          sendResponse({ success: false, error: "Target semantic element was not found in page DOM." });
          return;
        }

        const desc = {
          tagName: element.tagName,
          id: element.id,
          className: element.className,
          text: element.textContent?.trim().slice(0, 40)
        };

        if (message.action === "click") {
          // Identify if element is or is contained inside a navigation link
          const anchor = (element.tagName === "A" 
            ? element 
            : (element.closest("a[href]") || element.querySelector("a[href]"))) as HTMLAnchorElement | null;
          const targetHref = anchor?.href || "";
          const isNavigation = !!targetHref && !targetHref.startsWith("javascript:") && !targetHref.startsWith("#");

          // Dispatch full mouse event sequence for web components / Polymer / React compatibility
          element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
          element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
          element.click();

          // Fallback navigation enforcement for complex SPAs if location doesn't change
          if (isNavigation) {
            setTimeout(() => {
              if (typeof window !== "undefined" && window.location.href !== targetHref && !window.location.href.includes(targetHref)) {
                try {
                  window.location.href = targetHref;
                } catch {}
              }
            }, 300);
          }

          sendResponse({
            success: true,
            message: isNavigation ? `Clicked link, navigating to "${targetHref}"` : "Clicked element successfully.",
            element: desc,
            navigating: isNavigation,
            targetUrl: targetHref || undefined
          });
        } else if (message.action === "fill") {
          safeInsertTextIntoElement(element, message.value || "", "replace");
          
          // Only trigger Enter/submit if this is explicitly a search input
          const isSearchInput = element.getAttribute("type") === "search" || 
                                element.getAttribute("role") === "searchbox" ||
                                element.className?.toLowerCase?.().includes("search") ||
                                (element as HTMLInputElement).name?.toLowerCase?.().includes("search");
          if (isSearchInput) {
            element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
          }
          sendResponse({ success: true, message: `Filled "${message.value || ""}" successfully.`, element: desc });
        } else if (message.action === "focus") {
          element.focus();
          sendResponse({ success: true, message: "Focused element successfully.", element: desc });
        } else {
          sendResponse({ success: false, error: `Unsupported interaction action: ${message.action}` });
        }
      } catch (err: any) {
        sendResponse({ success: false, error: `Interaction failed: ${err.message}` });
      }
    })();
    return true;
  }

  // E-commerce direct add-to-cart runner (executed in page context)
  if (message.type === "ECOM_ADD_TO_CART") {
    (async () => {
      try {
        const { variantId, quantity = 1, selector, text } = message;

        // 1. If variantId is provided, try Shopify Cart AJAX API directly within the page origin
        if (variantId) {
          try {
            const res = await fetch("/cart/add.js", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: Number(variantId), quantity: Number(quantity) })
            });
            if (res.ok) {
              const cartData = await res.json();
              sendResponse({
                success: true,
                message: `Added item (Variant ID: ${variantId}) to cart via Shopify API.`,
                cart: cartData
              });
              return;
            }
          } catch (e: any) {
            console.warn("Shopify /cart/add.js direct call failed, falling back to DOM click:", e.message);
          }
        }

        // 2. Fallback: Find Add to Cart button semantically on the page and click it
        const targetBtn = findElementSemantically("BUTTON", text || "Add to Cart", selector);
        if (targetBtn) {
          targetBtn.scrollIntoView({ behavior: "smooth", block: "center" });
          targetBtn.click();
          sendResponse({
            success: true,
            message: `Clicked "${targetBtn.textContent?.trim() || "Add to Cart"}" button on page.`,
            element: { tagName: targetBtn.tagName, text: targetBtn.textContent?.trim() }
          });
          return;
        }

        // 3. Fallback: Form submission if form[action*="/cart"] exists
        const cartForm = document.querySelector('form[action*="/cart/add"], form[action*="/cart"]') as HTMLFormElement;
        if (cartForm) {
          const submitBtn = cartForm.querySelector('button[type="submit"], input[type="submit"], button') as HTMLElement;
          if (submitBtn) {
            submitBtn.click();
          } else {
            cartForm.submit();
          }
          sendResponse({
            success: true,
            message: "Submitted e-commerce product cart form."
          });
          return;
        }

        sendResponse({ success: false, error: "Could not find Add to Cart button or cart form on this page." });
      } catch (err: any) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true; // Keep message channel open for async response
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

        let videoTitle = document.title;
        let videoId = "";
        let description = "";

        try {
          const urlObj = new URL(window.location.href);
          videoId = urlObj.searchParams.get("v") || "";
        } catch {}

        const titleEl = document.querySelector("h1.ytd-watch-metadata yt-formatted-string, #title h1, h1.title");
        if (titleEl?.textContent?.trim()) {
          videoTitle = titleEl.textContent.trim();
        }

        const playerResponse = await getYoutubePlayerResponse();
        if (playerResponse) {
          if (playerResponse.videoDetails?.title) videoTitle = playerResponse.videoDetails.title;
          if (playerResponse.videoDetails?.videoId) videoId = playerResponse.videoDetails.videoId;
          if (playerResponse.videoDetails?.shortDescription) description = playerResponse.videoDetails.shortDescription;
        }

        const captionTracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
        let transcript: { text: string; start: number; duration: number }[] = [];

        if (captionTracks.length > 0) {
          // Candidate track search in order: English -> Urdu -> Hindi -> Any language
          const candidateTracks = [
            ...captionTracks.filter((t: any) => t.languageCode === "en" || t.languageCode === "ur" || t.languageCode === "hi"),
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
          if (transcript.length === 0) {
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
        }

        // Fallback 2: Native YouTube UI DOM Clicker & Scraper (clicks "Show transcript" button)
        if (transcript.length === 0) {
          console.log("No caption tracks succeeded. Running native YouTube DOM transcript scraper...");
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
      // Clamp horizontally to stay within viewport and vertically so it never hides off top
      const rawLeft = window.scrollX + (firstRect.left + firstRect.width / 2);
      const left = Math.max(80, Math.min(window.scrollX + window.innerWidth - 80, rawLeft));
      const top = (firstRect.top - 44 < 10) 
        ? (window.scrollY + firstRect.bottom + 8) 
        : (window.scrollY + firstRect.top - 44);

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

  // Dismiss floating tooltip on window scroll or resize
  window.addEventListener("scroll", () => {
    if (tooltipHost) removeMenu();
  }, { passive: true });

  window.addEventListener("resize", () => {
    if (tooltipHost) removeMenu();
  }, { passive: true });

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
    safeInsertTextIntoElement(activeInputElement, text, mode);
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
