const crypto = require("crypto");

function generateApiKey() {
  return crypto.randomBytes(32).toString("base64url");
}

function resolveApiKey(configuredKey = process.env.API_KEY) {
  if (configuredKey?.trim()) return { apiKey: configuredKey.trim(), generated: false };
  return { apiKey: generateApiKey(), generated: true };
}

function keysMatch(provided, expected) {
  if (typeof provided !== "string") return false;
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return providedBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}

function createAuthMiddleware(apiKey) {
  return function authMiddleware(req, res, next) {
    const authorization = req.headers.authorization;
    const provided = req.headers["x-api-key"] ||
      (typeof authorization === "string" ? authorization.replace(/^Bearer\s+/i, "") : undefined);
    if (!keysMatch(provided, apiKey)) {
      return res.status(401).json({ error: "Unauthorized: invalid or missing API key" });
    }
    next();
  };
}

module.exports = { createAuthMiddleware, generateApiKey, resolveApiKey };
