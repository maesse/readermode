const { Readability } = require("@mozilla/readability");
const { JSDOM } = require("jsdom");
const { TextDecoder } = require("util");

/**
 * Remove cookie consent banners, popups, overlays, and other noisy elements
 * from the DOM before passing it to Readability.
 */
function removePopupsAndConsent(document) {
  const selectors = [
    '#cookie-banner', '#cookie-consent', '#cookie-notice', '#cookie-bar',
    '#cookie-popup', '#cookie-modal', '#cookie-overlay', '#cookie-law',
    '#cookie-policy', '#cookie-message', '#cookie-warning', '#cookie-info',
    '#cookiebanner', '#cookieconsent', '#cookienotice', '#cookiebar',
    '#CybotCookiebotDialog', '#CybotCookiebotDialogBodyUnderlay',
    '#onetrust-banner-sdk', '#onetrust-consent-sdk',
    '#consent-banner', '#consent-popup', '#consent-modal',
    '#gdpr-banner', '#gdpr-consent', '#gdpr-popup',
    '#cc-main', '#cc_div',
    '.cookie-banner', '.cookie-consent', '.cookie-notice', '.cookie-bar',
    '.cookie-popup', '.cookie-modal', '.cookie-overlay', '.cookie-message',
    '.cookie-warning', '.cookiebanner', '.cookieconsent', '.cookienotice',
    '.cc-banner', '.cc-window', '.cc-overlay', '.cc-dialog',
    '.consent-banner', '.consent-popup', '.consent-modal', '.consent-overlay',
    '.gdpr-banner', '.gdpr-consent', '.gdpr-popup', '.gdpr-overlay',
    '.privacy-banner', '.privacy-popup',
    '.popup-overlay', '.modal-overlay', '.overlay-backdrop',
    '.newsletter-popup', '.newsletter-modal',
    '.notification-bar', '.alert-banner',
    '[class*="cookie-consent"]', '[class*="cookie-banner"]', '[class*="cookie-notice"]',
    '[id*="cookie-consent"]', '[id*="cookie-banner"]', '[id*="cookie-notice"]',
    '[class*="cookieconsent"]', '[class*="cookiebanner"]',
    '[id*="cookieconsent"]', '[id*="cookiebanner"]',
    '[class*="consent-banner"]', '[class*="consent-popup"]',
    '[id*="consent-banner"]', '[id*="consent-popup"]',
    '[aria-label*="cookie" i]', '[aria-label*="consent" i]',
    '[role="dialog"][class*="cookie" i]', '[role="dialog"][class*="consent" i]',
    '[data-cookieconsent]', '[data-cookie-banner]', '[data-consent]',
  ];

  let removedCount = 0;
  for (const selector of selectors) {
    try {
      const elements = document.querySelectorAll(selector);
      for (const el of elements) { el.remove(); removedCount++; }
    } catch { /* unsupported selector in jsdom */ }
  }

  const scripts = document.querySelectorAll('script[src]');
  for (const script of scripts) {
    const src = (script.getAttribute('src') || '').toLowerCase();
    if (['cookiebot', 'cookieconsent', 'cookie-consent', 'onetrust', 'quantcast', 'gdpr', 'consent']
      .some((k) => src.includes(k))) {
      script.remove();
      removedCount++;
    }
  }

  const allElements = document.querySelectorAll('div, aside, section, dialog');
  for (const el of allElements) {
    const style = el.getAttribute('style') || '';
    const text = (el.textContent || '').toLowerCase();
    const isOverlay =
      (style.includes('position: fixed') || style.includes('position:fixed') ||
       style.includes('position: sticky') || style.includes('position:sticky')) &&
      (text.includes('cookie') || text.includes('consent') ||
       text.includes('gdpr') || text.includes('privatlivspolitik') ||
       text.includes('cookiepolitik') || text.includes('samtykke'));
    if (isOverlay) { el.remove(); removedCount++; }
  }

  return removedCount;
}

/**
 * Decode an HTML buffer to a string, detecting the correct character encoding.
 */
function decodeHTML(buffer, contentType) {
  let charset = null;
  if (contentType) {
    const match = contentType.match(/charset=([^\s;]+)/i);
    if (match) charset = match[1].trim().toLowerCase();
  }

  if (!charset) {
    const preliminary = buffer.toString("utf-8");
    const metaCharset = preliminary.match(/<meta[^>]+charset=["']?([^"';\s>]+)/i);
    if (metaCharset) charset = metaCharset[1].trim().toLowerCase();
    if (!charset) {
      const httpEquiv = preliminary.match(
        /<meta[^>]+http-equiv=["']?content-type["']?[^>]+content=["'][^"']*charset=([^"';\s]+)/i
      );
      if (httpEquiv) charset = httpEquiv[1].trim().toLowerCase();
    }
  }

  const charsetMap = {
    "iso-8859-1": "windows-1252", "latin1": "windows-1252",
    "latin-1": "windows-1252", "ascii": "utf-8", "us-ascii": "utf-8",
  };
  if (charset && charsetMap[charset]) charset = charsetMap[charset];

  const encoding = charset || "utf-8";
  try {
    return new TextDecoder(encoding).decode(buffer);
  } catch {
    return new TextDecoder("utf-8").decode(buffer);
  }
}

/** Clean up HTML: unwrap empty spans, collapse whitespace, tidy tags. */
function cleanHTML(html) {
  let cleaned = html;
  let prev;
  do { prev = cleaned; cleaned = cleaned.replace(/<span>([^]*?)<\/span>/gi, "$1"); }
  while (cleaned !== prev);

  cleaned = cleaned.replace(/<(p|div|span|b|i|em|strong|h[1-6]|ul|ol|li|td|tr|th|table|tbody|thead)>\s*<\/\1>/gi, "");
  cleaned = cleaned.replace(/\t+/g, " ");
  cleaned = cleaned.replace(/ {2,}/g, " ");
  cleaned = cleaned.replace(/>\s+</g, "><");
  cleaned = cleaned.replace(/<\/(p|div|h[1-6]|li|tr|table|ul|ol|blockquote)>/gi, "</$1>\n");
  cleaned = cleaned.replace(/<br\s*\/?>/gi, "<br>\n");
  return cleaned.trim();
}

/** Clean up plain text: remove tabs, collapse blank lines, trim. */
function cleanText(text) {
  return text
    .replace(/\t/g, " ")
    .replace(/ {2,}/g, " ")
    .split("\n").map((l) => l.trim()).join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Fetch a URL, extract readable content, and return a cleaned article object.
 * @param {string} url
 * @returns {Promise<object>}
 */
async function readUrl(url) {
  // Validate
  new URL(url); // throws on invalid

  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const html = decodeHTML(buffer, response.headers.get("content-type"));
  const dom = new JSDOM(html, { url });

  removePopupsAndConsent(dom.window.document);

  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  if (!article) {
    throw new Error("Could not extract readable content from the page");
  }

  const cleanedContent = cleanHTML(article.content);
  const cleanedText = cleanText(article.textContent);

  return {
    title: article.title,
    byline: article.byline,
    content: cleanedContent,
    textContent: cleanedText,
    length: cleanedText.length,
    excerpt: article.excerpt,
    siteName: article.siteName,
  };
}

module.exports = { readUrl };
