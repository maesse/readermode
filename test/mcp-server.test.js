const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StreamableHTTPClientTransport } = require("@modelcontextprotocol/sdk/client/streamableHttp.js");
const { createApp } = require("../src/mcp-server");

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test("MCP client can discover and call read_url with structured truncation metadata", async (t) => {
  const articleServer = http.createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(`<!doctype html><html><head><title>Test article</title></head><body>
      <main><h1>Test article</h1><p>By Example Author</p>
      <p>${"Readable content ".repeat(80)} <a href="/source">source link</a></p></main>
      <script>window.rawDocumentMarker = true;</script></body></html>`);
  });
  const articlePort = await listen(articleServer);
  t.after(() => close(articleServer));

  const { app } = createApp({ host: "127.0.0.1", apiKey: "test-key", rateLimit: 100 });
  const mcpHttpServer = http.createServer(app);
  const mcpPort = await listen(mcpHttpServer);
  t.after(() => close(mcpHttpServer));

  const client = new Client({ name: "reader-mode-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${mcpPort}/mcp`),
    { requestInit: { headers: { "x-api-key": "test-key" } } }
  );
  await client.connect(transport);
  t.after(() => client.close());

  const tools = await client.listTools();
  const readTool = tools.tools.find((tool) => tool.name === "read_url");
  assert.ok(readTool);
  assert.equal(readTool.annotations.readOnlyHint, true);
  assert.deepEqual(readTool.inputSchema.properties.format.default, "markdown");

  const result = await client.callTool({
    name: "read_url",
    arguments: {
      url: `http://127.0.0.1:${articlePort}/article`,
      includeLinks: true,
      maxCharacters: 128,
    },
  });
  assert.equal(result.isError, undefined);
  assert.equal(result.content[0].text.length, 128);
  assert.match(result.content[0].text, /\[Truncated: \d+ characters omitted\]$/);
  assert.equal(result.structuredContent.truncated, true);
  assert.ok(result.structuredContent.omittedCharacters > 0);

  const rawResult = await client.callTool({
    name: "read_url",
    arguments: {
      url: `http://127.0.0.1:${articlePort}/article`,
      format: "raw_html",
      maxCharacters: 5000,
    },
  });
  assert.match(rawResult.content[0].text, /rawDocumentMarker/);
  assert.equal(rawResult.structuredContent.format, "raw_html");
});
