const assert = require("node:assert/strict");
const test = require("node:test");
const { createGlobalRateLimiter } = require("./rate-limit");

function response() {
  return {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test("global limiter enforces a rolling window", () => {
  let time = 0;
  const limiter = createGlobalRateLimiter({ limit: 2, windowMs: 1000, now: () => time });
  let accepted = 0;

  limiter({}, response(), () => accepted++);
  limiter({}, response(), () => accepted++);
  const rejected = response();
  limiter({}, rejected, () => accepted++);
  assert.equal(accepted, 2);
  assert.equal(rejected.statusCode, 429);
  assert.equal(rejected.headers["Retry-After"], 1);

  time = 1000;
  limiter({}, response(), () => accepted++);
  assert.equal(accepted, 3);
});
