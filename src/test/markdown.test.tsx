import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MarkdownRenderer } from '../components/MarkdownRenderer';

describe('MarkdownRenderer Component', () => {
  it('renders plain text content correctly', () => {
    render(<MarkdownRenderer text="Hello world from Visper AI" theme="dark" />);
    expect(screen.getByText('Hello world from Visper AI')).toBeInTheDocument();
  });

  it('renders inline bold, italic, and code formatting', () => {
    const text = 'This is **bold** and *italic* and `code` inline.';
    render(<MarkdownRenderer text={text} theme="dark" />);
    
    expect(screen.getByText('bold')).toBeInTheDocument();
    expect(screen.getByText('italic')).toBeInTheDocument();
    expect(screen.getByText('code')).toBeInTheDocument();
  });

  it('renders fenced code blocks with language tag', () => {
    const codeMarkdown = '```typescript\nconst x = 42;\n```';
    render(<MarkdownRenderer text={codeMarkdown} theme="dark" />);
    
    expect(screen.getByText('typescript')).toBeInTheDocument();
    expect(screen.getByText('const x = 42;')).toBeInTheDocument();
  });

  it('renders markdown headings correctly', () => {
    const headingMarkdown = '# Section Title\n## Subsection Title';
    render(<MarkdownRenderer text={headingMarkdown} theme="dark" />);
    
    expect(screen.getByText('Section Title')).toBeInTheDocument();
    expect(screen.getByText('Subsection Title')).toBeInTheDocument();
  });

  it('renders copy button on code blocks', () => {
    const codeMarkdown = '```python\nprint("Hello")\n```';
    render(<MarkdownRenderer text={codeMarkdown} theme="dark" />);
    
    expect(screen.getByText('Copy')).toBeInTheDocument();
    expect(screen.getByText('print("Hello")')).toBeInTheDocument();
  });

  it('renders clickable YouTube timestamp pills for video navigation', () => {
    const textWithTimestamps = 'Check out the intro at [01:23] and the conclusion at [14:05].';
    render(<MarkdownRenderer text={textWithTimestamps} theme="dark" />);
    
    expect(screen.getByText('01:23')).toBeInTheDocument();
    expect(screen.getByText('14:05')).toBeInTheDocument();
  });

  it('safely handles unclosed code blocks during active streaming without slicing code', () => {
    const streamingCode = '```javascript\nconst streamRunning = true;';
    render(<MarkdownRenderer text={streamingCode} theme="dark" />);
    
    expect(screen.getByText('const streamRunning = true;')).toBeInTheDocument();
  });
});
