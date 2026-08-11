const { JSDOM } = require("jsdom");
const { cleanText } = require("./reader");

const BLOCK_TAGS = new Set([
  "ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "DIV", "DL", "FIELDSET",
  "FIGCAPTION", "FIGURE", "FOOTER", "FORM", "H1", "H2", "H3", "H4",
  "H5", "H6", "HEADER", "HR", "LI", "MAIN", "NAV", "OL", "P", "PRE",
  "SECTION", "TABLE", "TR", "UL",
]);

function markdownFromHtml(html, includeLinks) {
  const fragment = JSDOM.fragment(html);

  function render(node) {
    if (node.nodeType === 3) return node.nodeValue || "";
    if (node.nodeType !== 1 && node.nodeType !== 11) return "";

    const children = Array.from(node.childNodes, render).join("");
    if (node.nodeName === "BR") return "\n";
    if (node.nodeName === "A" && includeLinks) {
      const label = cleanText(children);
      const href = node.getAttribute("href");
      if (!href || !label) return children;
      return label === href ? href : `[${label}](${href})`;
    }
    if (node.nodeName === "LI") return `\n- ${children}\n`;
    return BLOCK_TAGS.has(node.nodeName) ? `\n${children}\n` : children;
  }

  return cleanText(render(fragment));
}

function htmlWithLinkPreference(html, includeLinks) {
  if (includeLinks) return html;
  const fragment = JSDOM.fragment(html);
  for (const anchor of fragment.querySelectorAll("a")) anchor.replaceWith(...anchor.childNodes);
  const wrapper = fragment.ownerDocument.createElement("div");
  wrapper.append(fragment);
  return wrapper.innerHTML;
}

function renderArticle(article, { format = "markdown", includeLinks = false } = {}) {
  if (format === "raw_html") return article.rawHtml;
  if (format === "html") return htmlWithLinkPreference(article.content, includeLinks);

  const body = format === "markdown" && includeLinks
    ? markdownFromHtml(article.content, true)
    : article.textContent;
  const title = format === "markdown" ? `# ${article.title}` : article.title;
  const byline = article.byline
    ? (format === "markdown" ? `*By ${article.byline}*` : `By ${article.byline}`)
    : null;

  return [title, byline, article.siteName ? `Source: ${article.siteName}` : null, "", body]
    .filter((value) => value !== null)
    .join("\n");
}

function truncateWithMarker(text, maxCharacters) {
  if (!maxCharacters || text.length <= maxCharacters) {
    return { text, truncated: false, omittedCharacters: 0, originalCharacters: text.length };
  }

  let keptCharacters = maxCharacters;
  let marker = "";
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const omittedCharacters = text.length - keptCharacters;
    marker = `\n\n[Truncated: ${omittedCharacters} characters omitted]`;
    const nextKept = Math.max(0, maxCharacters - marker.length);
    if (nextKept === keptCharacters) break;
    keptCharacters = nextKept;
  }

  const omittedCharacters = text.length - keptCharacters;
  marker = `\n\n[Truncated: ${omittedCharacters} characters omitted]`;
  keptCharacters = Math.max(0, maxCharacters - marker.length);

  return {
    text: text.slice(0, keptCharacters) + marker,
    truncated: true,
    omittedCharacters: text.length - keptCharacters,
    originalCharacters: text.length,
  };
}

module.exports = { htmlWithLinkPreference, markdownFromHtml, renderArticle, truncateWithMarker };
