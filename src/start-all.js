const { spawn } = require("child_process");
const path = require("path");
const { resolveApiKey } = require("./auth");

const keyInfo = resolveApiKey();
if (keyInfo.generated) {
  console.log("No API_KEY was provided. Generated shared API key for this launch:");
  console.log(keyInfo.apiKey);
}

const env = { ...process.env, API_KEY: keyInfo.apiKey };
const children = ["server.js", "mcp-server.js"].map((script) =>
  spawn(process.execPath, [path.join(__dirname, script)], { env, stdio: "inherit" })
);
let stopping = false;

function stop(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
}

for (const child of children) {
  child.on("exit", (code, signal) => {
    if (!stopping) {
      process.exitCode = code ?? (signal ? 1 : 0);
      stop();
    }
  });
}

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));
