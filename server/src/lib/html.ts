/**
 * Shared HTML → text / markdown utilities.
 *
 * Single source of truth — import from here instead of copy-pasting.
 */

/** Strip all HTML tags and decode entities → plain text, preserving paragraph breaks. */
export function htmlToText(html: string): string {
  if (!html) return '';
  return html
    .replace(/<\/p>/gi,      '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g,     '')
    .replace(/&amp;/g,  '&')
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g,  "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Alias — some files call it stripHtml */
export const stripHtml = htmlToText;

/** HTML → minimal Markdown (bold, italic, headings, paragraphs, lists). */
export function htmlToMarkdown(html: string): string {
  if (!html) return '';
  return html
    .replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n\n')
    .replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n\n')
    .replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n\n')
    .replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**')
    .replace(/<b[^>]*>(.*?)<\/b>/gi,           '**$1**')
    .replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*')
    .replace(/<i[^>]*>(.*?)<\/i>/gi,   '*$1*')
    .replace(/<u[^>]*>(.*?)<\/u>/gi,   '_$1_')
    .replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n')
    .replace(/<\/p>/gi,      '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g,     '')
    .replace(/&amp;/g,  '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Count words in plain text or HTML. */
export function wordCount(htmlOrText: string): number {
  const text = htmlOrText.includes('<') ? htmlToText(htmlOrText) : htmlOrText;
  return text.split(/\s+/).filter(Boolean).length;
}
