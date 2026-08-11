const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { createMcpExpressApp } = require("@modelcontextprotocol/sdk/server/express.js");
const { SSEServerTransport } = require("@modelcontextprotocol/sdk/server/sse.js");
const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const { z } = require("zod");
const { createAuthMiddleware, resolveApiKey } = require("./auth");
const { renderArticle, truncateWithMarker } = require("./output");
const { createGlobalRateLimiter } = require("./rate-limit");
const { readUrl } = require("./reader");

const SERVER_VERSION = "1.1.0";

function positiveInteger(value, fallback, name) {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function createReaderMcpServer({ defaultMaxCharacters = 50000 } = {}) {
  const server = new McpServer(
    { name: "reader-mode", version: SERVER_VERSION },
    {
      capabilities: { tools: {} },
      instructions:
        "Use read_url to extract the main content from HTTP(S) pages. Prefer markdown for model-readable output, " +
        "request html only when markup matters, and request raw_html only when the original document is required.",
    }
  );

  server.registerTool(
    "read_url",
    {
      title: "Read a web page",
      description:
        "Fetch a web page and extract its main readable content with Mozilla Readability. " +
        "Can return Markdown, plain text, cleaned article HTML, or the original raw HTML. " +
        "Output is capped with an explicit truncation marker when maxCharacters is exceeded.",
      inputSchema: {
        url: z.string().url().describe("The full HTTP or HTTPS URL to read"),
        format: z.enum(["markdown", "text", "html", "raw_html"])
          .default("markdown")
          .describe("Output representation. raw_html is the unprocessed downloaded document."),
        includeLinks: z.boolean()
          .default(false)
          .describe("Keep link targets in Markdown or cleaned HTML. Ignored for text and raw_html."),
        maxCharacters: z.number().int().min(128).max(1000000)
          .default(defaultMaxCharacters)
          .describe("Maximum returned text length, including any truncation marker."),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ url, format, includeLinks, maxCharacters }) => {
      try {
        const article = await readUrl(url, { includeRawHtml: format === "raw_html" });
        const rendered = renderArticle(article, { format, includeLinks });
        const limited = truncateWithMarker(rendered, maxCharacters);

        return {
          content: [{ type: "text", text: limited.text }],
          structuredContent: {
            url,
            title: article.title,
            byline: article.byline || null,
            siteName: article.siteName || null,
            excerpt: article.excerpt || null,
            format,
            includeLinks: format === "raw_html" || format === "text" ? null : includeLinks,
            truncated: limited.truncated,
            omittedCharacters: limited.omittedCharacters,
            originalCharacters: limited.originalCharacters,
          },
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: `Error: ${error.message}` }],
        };
      }
    }
  );

  return server;
}

function createApp(options = {}) {
  const host = options.host || process.env.MCP_HOST || "127.0.0.1";
  const allowedHostsValue = options.allowedHosts ?? process.env.MCP_ALLOWED_HOSTS;
  const allowedHosts = typeof allowedHostsValue === "string"
    ? allowedHostsValue.split(",").map((value) => value.trim()).filter(Boolean)
    : allowedHostsValue;
  const apiKeyInfo = options.apiKey
    ? { apiKey: options.apiKey, generated: false }
    : resolveApiKey();
  const rateLimit = positiveInteger(
    options.rateLimit ?? process.env.MCP_RATE_LIMIT_PER_SECOND,
    10,
    "MCP_RATE_LIMIT_PER_SECOND"
  );
  const defaultMaxCharacters = positiveInteger(
    options.defaultMaxCharacters ?? process.env.MCP_MAX_OUTPUT_CHARACTERS,
    50000,
    "MCP_MAX_OUTPUT_CHARACTERS"
  );

  const app = createMcpExpressApp({ host, ...(allowedHosts?.length ? { allowedHosts } : {}) });
  const authMiddleware = createAuthMiddleware(apiKeyInfo.apiKey);
  const sseSessions = new Map();

  app.use(createGlobalRateLimiter({ limit: rateLimit }));

  app.get("/healthz", (_req, res) => {
    res.json({ status: "ok", name: "reader-mode", version: SERVER_VERSION });
  });

  app.post("/mcp", authMiddleware, async (req, res) => {
    const mcpServer = createReaderMcpServer({ defaultMaxCharacters });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => mcpServer.close().catch(() => {}));
    try {
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("MCP request failed:", error);
      if (!res.headersSent) res.status(500).json({ error: "MCP request failed" });
    }
  });

  app.get("/mcp", authMiddleware, (_req, res) => {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "This server uses stateless Streamable HTTP; send MCP messages with POST" });
  });

  app.delete("/mcp", authMiddleware, (_req, res) => {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "This server does not create Streamable HTTP sessions" });
  });

  app.get("/sse", authMiddleware, async (req, res) => {
    const mcpServer = createReaderMcpServer({ defaultMaxCharacters });
    const transport = new SSEServerTransport("/messages", res);
    sseSessions.set(transport.sessionId, { mcpServer, transport });
    res.on("close", () => {
      sseSessions.delete(transport.sessionId);
      mcpServer.close().catch(() => {});
    });
    try {
      await mcpServer.connect(transport);
    } catch (error) {
      sseSessions.delete(transport.sessionId);
      console.error("SSE connection failed:", error);
      if (!res.headersSent) res.status(500).end();
    }
  });

  app.post("/messages", authMiddleware, async (req, res) => {
    const session = sseSessions.get(req.query.sessionId);
    if (!session) return res.status(400).json({ error: "Unknown session" });
    try {
      await session.transport.handlePostMessage(req, res, req.body);
    } catch (error) {
      console.error("SSE message failed:", error);
      if (!res.headersSent) res.status(500).json({ error: "SSE message failed" });
    }
  });

  return { app, apiKeyInfo, host, rateLimit, defaultMaxCharacters };
}

function startServer(options = {}) {
  const port = positiveInteger(options.port ?? process.env.MCP_PORT ?? process.env.PORT, 3001, "MCP_PORT");
  const state = createApp(options);
  const httpServer = state.app.listen(port, state.host, () => {
    console.log(`Reader Mode MCP server running on http://${state.host}:${port}`);
    console.log(`  Streamable HTTP: POST http://${state.host}:${port}/mcp`);
    console.log(`  SSE (legacy):    GET  http://${state.host}:${port}/sse`);
    console.log(`  Global limit:    ${state.rateLimit} requests/second`);
    if (state.apiKeyInfo.generated) {
      console.log("No API_KEY was provided. Generated API key for this launch:");
      console.log(state.apiKeyInfo.apiKey);
    } else {
      console.log("API key authentication enabled");
    }
  });
  return { ...state, httpServer, port };
}

if (require.main === module) startServer();

module.exports = { createApp, createReaderMcpServer, positiveInteger, startServer };
