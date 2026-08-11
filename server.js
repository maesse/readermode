const express = require("express");
const { createAuthMiddleware, resolveApiKey } = require("./auth");
const { createGlobalRateLimiter } = require("./rate-limit");
const { readUrl } = require("./reader");

const app = express();
const PORT = process.env.PORT || 3000;
const { apiKey: API_KEY, generated: GENERATED_API_KEY } = resolveApiKey();
const RATE_LIMIT = Number(process.env.API_RATE_LIMIT_PER_SECOND || 10);

app.use(express.json());
app.use(createGlobalRateLimiter({ limit: RATE_LIMIT }));
app.use("/api", createAuthMiddleware(API_KEY));

app.get("/api/read", async (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: "Missing required query parameter: url" });
  }

  try {
    const article = await readUrl(url);
    res.json(article);
  } catch (err) {
    console.error("Error processing URL:", err.message);
    if (err.message.includes("Invalid URL")) {
      return res.status(400).json({ error: "Invalid URL" });
    }
    if (err.message.includes("Failed to fetch")) {
      return res.status(502).json({ error: err.message });
    }
    if (err.message.includes("Could not extract")) {
      return res.status(422).json({ error: err.message });
    }
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Reader Mode API running on http://localhost:${PORT}`);
  if (GENERATED_API_KEY) {
    console.log("No API_KEY was provided. Generated API key for this launch:");
    console.log(API_KEY);
  } else console.log("API key authentication enabled");
});
