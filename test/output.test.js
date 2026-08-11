const assert = require("node:assert/strict");
const test = require("node:test");
const { htmlWithLinkPreference, markdownFromHtml, truncateWithMarker } = require("../src/output");

test("markdown link handling is optional", () => {
  const html = '<p>Hello <a href="https://example.com/path">world</a>.</p>';
  assert.equal(markdownFromHtml(html, false), "Hello world.");
  assert.equal(markdownFromHtml(html, true), "Hello [world](https://example.com/path).");
});

test("cleaned HTML can unwrap links without dropping their labels", () => {
  assert.equal(htmlWithLinkPreference('<p><a href="/x">keep me</a></p>', false), "<p>keep me</p>");
});

test("truncation includes an exact omission marker within the requested cap", () => {
  const input = "x".repeat(1000);
  const result = truncateWithMarker(input, 128);
  assert.equal(result.text.length, 128);
  assert.match(result.text, /\[Truncated: \d+ characters omitted\]$/);
  assert.equal(result.omittedCharacters + result.text.indexOf("\n\n[Truncated:"), input.length);
  assert.equal(result.originalCharacters, input.length);
});

test("short output is unchanged", () => {
  assert.deepEqual(truncateWithMarker("short", 128), {
    text: "short",
    truncated: false,
    omittedCharacters: 0,
    originalCharacters: 5,
  });
});
