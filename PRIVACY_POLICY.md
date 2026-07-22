# Privacy Policy for Visper AI

**Effective Date:** July 22, 2026  
**Extension Name:** Visper AI (v2.5.0)  
**Publisher:** Visper AI Development Team  

---

## 1. Single Purpose & Overview
Visper AI is an autonomous AI browser assistant and copilot extension designed solely to enhance web productivity. Its single purpose is to assist users with web content interaction, e-commerce shopping automation, web research synthesis, document vector search, and YouTube transcript summaries.

---

## 2. Information Collection and Usage

### A. Data Stored Locally
* **API Keys & Settings:** API keys provided by the user (OpenAI, Anthropic, Gemini, Groq, DeepSeek) and extension configurations are stored **100% locally** on the user's browser using `chrome.storage.local`.
* **Local Semantic Memory (RAG):** Past chat history and uploaded PDF document chunks are vectorized locally using WebAssembly (Transformers.js ONNX) and stored locally in IndexedDB.
* **No Telemetry or Third-Party Tracking:** Visper AI does **NOT** use tracking cookies, analytics SDKs, or external telemetry servers.

### B. Network Data Transmission
* **AI Model Requests:** When a user submits a prompt, the text query and relevant page context are sent directly to the user-selected AI model provider API (e.g. OpenAI, Anthropic, Google Gemini, Groq, DeepSeek) or processed completely offline via Chrome Gemini Nano.
* **Direct Connections:** All network requests occur via encrypted HTTPS directly between the user's browser and the AI provider. Visper AI operates with no middleman server.

---

## 3. Permissions Justification

Visper AI requests only the minimum permissions necessary for its single purpose:

* `sidePanel`: Required to display the Visper AI assistant user interface alongside active web pages.
* `activeTab`: Required to extract text context from the currently active web page when requested by the user.
* `tabs`: Required to open research tabs or switch tabs during automated multi-tab tasks.
* `scripting`: Required to execute non-intrusive DOM action heuristics (such as clicking buttons or filling form fields) when authorized by the user.
* `storage`: Required to save local user preferences, selected AI models, and chat history.
* `offscreen`: Required to process WebAssembly ONNX text embeddings locally for semantic RAG memory search without blocking UI performance.
* `<all_urls>` (Host Permission): Required to allow the assistant to read web content and assist on any website requested by the user.

---

## 4. Third-Party Data Sharing
Visper AI does **NOT** sell, rent, trade, or transfer user data to third parties under any circumstances. User data is strictly used to fulfill AI prompt completions requested by the user.

---

## 5. User Controls & Data Erasure
Users retain complete ownership and control of their data:
* All local chat histories and IndexedDB vector databases can be erased at any time via the extension settings panel.
* Uninstalling the extension completely removes all stored data from the browser.

---

## 6. Contact & Support
For privacy questions or support regarding Visper AI, please open an issue on the official GitHub repository:  
`https://github.com/HassaanInspires/visper-ai`
