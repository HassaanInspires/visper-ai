import { pipeline, env } from "@xenova/transformers";
// @ts-ignore
import * as pdfjsLib from "pdfjs-dist/build/pdf.min.mjs";

// Configure transformers env for extension compatibility (allowing CDN download)
env.allowLocalModels = false;

// Load ONNX WebAssembly binaries from the local extension package (complying with MV3 CSP)
env.backends.onnx.wasm.wasmPaths = "/";

// Force ONNX Runtime to use a single thread (disables WASM multi-threading)
env.backends.onnx.wasm.numThreads = 1;

// Disable proxying WASM execution to a separate Worker thread (prevents importScripts blob CSP block!)
env.backends.onnx.wasm.proxy = false;

// Configure pdfjs worker path to point to our local extension package asset
// @ts-ignore
pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

// Promise for caching extractor
let extractorPromise: any = null;

async function getExtractor() {
  if (!extractorPromise) {
    console.log("Initializing all-MiniLM-L6-v2 pipeline in offscreen document...");
    extractorPromise = pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  }
  return extractorPromise;
}

// Extract PDF text and slice it into page-aware chunks
async function extractTextAndChunk(arrayBuffer: ArrayBuffer, chunkSize = 500, overlap = 50) {
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) });
  const pdf = await loadingTask.promise;
  const chunks: Array<{ text: string; pageNumber: number }> = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      // @ts-ignore
      .map((item: any) => item.str)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    if (!pageText || pageText.length < 5) continue;

    // Chunk this page content
    let startIndex = 0;
    while (startIndex < pageText.length) {
      const chunkText = pageText.substring(startIndex, startIndex + chunkSize).trim();
      if (chunkText.length > 15) {
        chunks.push({
          text: chunkText,
          pageNumber: i
        });
      }
      startIndex += (chunkSize - overlap);
    }
  }
  return chunks;
}

// Listen for message events from background service worker
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "CALCULATE_EMBEDDING_OFFSCREEN") {
    (async () => {
      try {
        const extractor = await getExtractor();
        console.log(`Extracting vector embeddings for text: "${message.text.slice(0, 30)}..."`);
        const output = await extractor(message.text, { pooling: "mean", normalize: true });
        
        // Extract array from Tensor output
        const vector = Array.from(output.data);
        sendResponse({ success: true, vector });
      } catch (err: any) {
        console.error("Offscreen embeddings calculation error:", err);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true; // Keep message port active for async response
  }

  if (message.type === "PARSE_AND_VECTORIZE_PDF") {
    (async () => {
      try {
        const { arrayBuffer, documentId } = message;
        if (!arrayBuffer) {
          throw new Error("No PDF arrayBuffer provided.");
        }

        console.log(`Starting parsing for document: ${documentId}`);
        const chunks = await extractTextAndChunk(arrayBuffer);
        console.log(`PDF text parsed: extracted ${chunks.length} chunks.`);

        const extractor = await getExtractor();
        const vectorizedChunks: Array<{ text: string; pageNumber: number; vector: number[] }> = [];

        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          const output = await extractor(chunk.text, { pooling: "mean", normalize: true });
          const vector = Array.from(output.data) as number[];
          
          vectorizedChunks.push({
            text: chunk.text,
            pageNumber: chunk.pageNumber,
            vector
          });

          // Broadcast periodic indexing progress update
          if (i % 5 === 0 || i === chunks.length - 1) {
            chrome.runtime.sendMessage({
              type: "INDEXING_PROGRESS",
              documentId,
              progress: Math.round(((i + 1) / chunks.length) * 100)
            }).catch(() => {});
          }
        }

        sendResponse({ success: true, chunks: vectorizedChunks });
      } catch (err: any) {
        console.error("Offscreen PDF parsing & vectorization failed:", err);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  if (message.type === "PARSE_DDG_SEARCH") {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(message.html, "text/html");
      const results: Array<{ title: string; url: string; snippet: string }> = [];

      const resultElements = doc.querySelectorAll(".result");
      resultElements.forEach((el) => {
        const titleEl = el.querySelector(".result__title .result__a");
        const snippetEl = el.querySelector(".result__snippet");
        if (titleEl && snippetEl) {
          const title = titleEl.textContent?.trim() || "";
          let url = titleEl.getAttribute("href") || "";
          if (url.startsWith("//")) {
            url = "https:" + url;
          }
          if (url.includes("uddg=")) {
            const match = url.match(/uddg=([^&]+)/);
            if (match) {
              url = decodeURIComponent(match[1]);
            }
          }
          const snippet = snippetEl.textContent?.trim() || "";
          if (title && url) {
            results.push({ title, url, snippet });
          }
        }
      });

      if (results.length === 0) {
        const liteRows = doc.querySelectorAll(".result-links");
        liteRows.forEach((row) => {
          const titleEl = row.querySelector(".result-title");
          const snippetEl = row.nextElementSibling?.querySelector(".result-snippet");
          if (titleEl && snippetEl) {
            const title = titleEl.textContent?.trim() || "";
            const url = titleEl.getAttribute("href") || "";
            const snippet = snippetEl.textContent?.trim() || "";
            if (title && url) {
              results.push({ title, url, snippet });
            }
          }
        });
      }

      sendResponse({ success: true, results: results.slice(0, 5) });
    } catch (e: any) {
      sendResponse({ success: false, error: e.message });
    }
    return false;
  }

  if (message.type === "CLEAN_PAGE_HTML") {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(message.html, "text/html");
      
      const elementsToRemove = doc.querySelectorAll(
        "script, style, iframe, noscript, svg, header, footer, nav, aside, .header, .footer, .nav, .menu, .sidebar"
      );
      elementsToRemove.forEach(el => el.remove());
      
      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
      const textNodes: string[] = [];
      let node;
      while ((node = walker.nextNode())) {
        const text = node.textContent?.trim() || "";
        if (text.length > 3 && !textNodes.includes(text)) {
          textNodes.push(text);
        }
      }
      const cleaned = textNodes.slice(0, 400).join(" ");
      sendResponse({ success: true, text: cleaned });
    } catch (e: any) {
      sendResponse({ success: false, error: e.message });
    }
    return false;
  }
});

console.log("Visper Offscreen context ready.");
