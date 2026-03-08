const express = require("express");
const { readUrl } = require("./reader");

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY;

app.use(express.json());

// API key authentication middleware
app.use("/api", (req, res, next) => {
  if (!API_KEY) {
    // No key configured — allow all requests (dev mode)
    return next();
  }
  const provided =
    req.headers["x-api-key"] ||
    req.headers["authorization"]?.replace(/^Bearer\s+/i, "");
  if (provided !== API_KEY) {
    return res.status(401).json({ error: "Unauthorized: invalid or missing API key" });
  }
  next();
});

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
  if (API_KEY) {
    console.log("API key authentication enabled");
  } else {
    console.log("WARNING: No API_KEY set — running without authentication");
  }
});
