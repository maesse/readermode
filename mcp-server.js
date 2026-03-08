const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { SSEServerTransport } = require("@modelcontextprotocol/sdk/server/sse.js");
const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const express = require("express");
const { readUrl } = require("./reader");
const { z } = require("zod");

const PORT = process.env.MCP_PORT || process.env.PORT || 3001;
const API_KEY = process.env.API_KEY || 'secret-key';

// Create the MCP server
const mcpServer = new McpServer({
  name: "reader-mode",
  version: "1.0.0",
}, {
  capabilities: { tools: {} },
});

// Register the read_url tool
mcpServer.tool(
  "read_url",
  "Fetch a web page and extract its main readable content using Mozilla Readability. " +
  "Returns the article title, author, cleaned HTML content, plain text, excerpt, and site name. " +
  "Automatically handles character encoding detection and removes cookie banners / consent popups.",
  {
    url: z.string().url().describe("The full URL of the web page to read"),
  },
  async ({ url }) => {
    try {
      const article = await readUrl(url);
      const textResult = [
        `# ${article.title}`,
        article.byline ? `*By ${article.byline}*` : null,
        article.siteName ? `Source: ${article.siteName}` : null,
        "",
        article.textContent,
      ]
        .filter(Boolean)
        .join("\n");

      return {
        content: [{ type: "text", text: textResult }],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error: ${err.message}` }],
      };
    }
  }
);

// --- Express app for HTTP transport ---
const app = express();

// Body parsing — must be before routes
app.use(express.json());

// API key auth middleware
function authMiddleware(req, res, next) {
  if (!API_KEY) return next();
  const provided =
    req.headers["x-api-key"] ||
    req.headers["authorization"]?.replace(/^Bearer\s+/i, "");
  if (provided !== API_KEY) {
    return res.status(401).json({ error: "Unauthorized: invalid or missing API key" });
  }
  next();
}

// --- Streamable HTTP transport (MCP 2025-03-26) ---
app.post("/mcp", authMiddleware, async (req, res) => {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => transport.close());
  await mcpServer.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

// --- SSE transport (legacy, for older MCP clients) ---
const sseTransports = {};

app.get("/sse", authMiddleware, async (req, res) => {
  const transport = new SSEServerTransport("/messages", res);
  sseTransports[transport.sessionId] = transport;
  res.on("close", () => { delete sseTransports[transport.sessionId]; });
  await mcpServer.connect(transport);
});

app.post("/messages", authMiddleware, async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = sseTransports[sessionId];
  if (!transport) {
    return res.status(400).json({ error: "Unknown session" });
  }
  await transport.handlePostMessage(req, res, req.body);
});

app.listen(PORT, () => {
  console.log(`Reader Mode MCP server running on http://localhost:${PORT}`);
  console.log(`  Streamable HTTP: POST http://localhost:${PORT}/mcp`);
  console.log(`  SSE (legacy):    GET  http://localhost:${PORT}/sse`);
  if (API_KEY) {
    console.log("API key authentication enabled");
  } else {
    console.log("WARNING: No API_KEY set — running without authentication");
  }
});
