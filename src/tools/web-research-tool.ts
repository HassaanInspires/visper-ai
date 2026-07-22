// Visper AI: Dedicated Multi-Site Web Research & Comparison Matrix Generator
// Performs background silent web scraping (0 tab clutter) and generates formatted Markdown comparison matrices.

export interface ResearchSourceResult {
  title: string;
  url: string;
  snippet: string;
  extractedText?: string;
}

export interface ResearchMatrixReport {
  query: string;
  sourcesCount: number;
  markdownMatrix: string;
  sources: ResearchSourceResult[];
}

/**
  * Executes silent background multi-site research for a given query
  * Bypasses opening browser tabs by making background fetch calls to search engines and target pages
  */
export async function executeSilentWebResearch(query: string, maxSources: number = 5): Promise<ResearchMatrixReport> {
  console.log(`Visper ResearchTool: Executing silent background research for "${query}"...`);
  
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
  const sources: ResearchSourceResult[] = [];

  try {
    const res = await fetch(searchUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      }
    });

    if (res.ok) {
      const htmlText = await res.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlText, "text/html");

      // Extract search result anchors and snippets
      const searchBlocks = doc.querySelectorAll("div.g, div.tF2C2c, div.MjjYud");
      searchBlocks.forEach((block, idx) => {
        if (sources.length >= maxSources) return;
        const linkEl = block.querySelector("a[href^='http']") as HTMLAnchorElement;
        const titleEl = block.querySelector("h3");
        const snippetEl = block.querySelector(".VwiC3b, .st, .aCOpRe");

        if (linkEl && titleEl && linkEl.href && !linkEl.href.includes("google.com")) {
          sources.push({
            title: titleEl.textContent?.trim() || `Source ${idx + 1}`,
            url: linkEl.href,
            snippet: snippetEl?.textContent?.trim() || "No snippet available."
          });
        }
      });
    }
  } catch (err) {
    console.warn("Visper ResearchTool background search fetch error:", err);
  }

  // Generate clean Markdown Comparison Matrix
  const markdownMatrix = formatResearchMatrix(query, sources);

  return {
    query,
    sourcesCount: sources.length,
    markdownMatrix,
    sources
  };
}

/**
  * Formats raw research sources into a beautifully formatted Markdown Comparison Matrix Table
  */
export function formatResearchMatrix(query: string, sources: ResearchSourceResult[]): string {
  if (sources.length === 0) {
    return `### Research Results for "${query}"\nNo direct external search sources could be retrieved in silent background mode. You can try opening a search tab directly.`;
  }

  let md = `### 🔍 Multi-Site Research Matrix for "${query}"\n\n`;
  md += `| # | Source / Platform | Key Information / Findings | Link |\n`;
  md += `|---|---|---|---|\n`;

  sources.forEach((src, idx) => {
    const cleanTitle = src.title.replace(/\|/g, "-");
    const cleanSnippet = src.snippet.replace(/\|/g, "-").replace(/\n/g, " ");
    md += `| ${idx + 1} | **${cleanTitle}** | ${cleanSnippet} | [Visit Page](${src.url}) |\n`;
  });

  md += `\n*Found ${sources.length} sources via silent background search (0 browser tabs opened).*`;
  return md;
}
