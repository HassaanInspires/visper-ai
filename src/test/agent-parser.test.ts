import { describe, it, expect } from 'vitest';

function tryRepairJson(raw: string): any {
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
}

describe('Agent Action Block JSON Parser & Repair', () => {
  it('parses valid JSON action blocks', () => {
    const jsonStr = '{"action": "browser_action", "browserAction": "open_tab", "url": "https://google.com"}';
    const parsed = JSON.parse(jsonStr);
    expect(parsed.action).toBe('browser_action');
    expect(parsed.url).toBe('https://google.com');
  });

  it('repairs truncated JSON strings missing closing quotes and braces', () => {
    const truncated = '{"action": "dom_interact", "domAction": "fill", "value": "unclosed string';
    const repaired = tryRepairJson(truncated);
    expect(repaired).not.toBeNull();
    expect(repaired.action).toBe('dom_interact');
    expect(repaired.value).toBe('unclosed string');
  });

  it('repairs nested missing closing braces', () => {
    const truncated = '{"action": "call_tool", "tool": "search", "arguments": {"query": "Vite"';
    const repaired = tryRepairJson(truncated);
    expect(repaired).not.toBeNull();
    expect(repaired.action).toBe('call_tool');
    expect(repaired.arguments.query).toBe('Vite');
  });

  it('returns null for unrepairable invalid text', () => {
    expect(tryRepairJson('Not a JSON string')).toBeNull();
  });
});
