function createGlobalRateLimiter({ limit = 10, windowMs = 1000, now = Date.now } = {}) {
  const timestamps = [];

  return function globalRateLimiter(req, res, next) {
    const currentTime = now();
    while (timestamps.length && timestamps[0] <= currentTime - windowMs) timestamps.shift();

    res.setHeader("RateLimit-Limit", limit);
    res.setHeader("RateLimit-Remaining", Math.max(0, limit - timestamps.length - 1));

    if (timestamps.length >= limit) {
      const retryAfterMs = Math.max(1, timestamps[0] + windowMs - currentTime);
      res.setHeader("Retry-After", Math.ceil(retryAfterMs / 1000));
      res.setHeader("RateLimit-Remaining", 0);
      return res.status(429).json({ error: "Rate limit exceeded", retryAfterMs });
    }

    timestamps.push(currentTime);
    next();
  };
}

module.exports = { createGlobalRateLimiter };
