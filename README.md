# Reader Mode MCP server

Fetch a web page and extract its main article with Mozilla Readability. The project exposes both an MCP server and a small REST API.

## Run

```sh
npm ci
npm run start:mcp
```

The MCP endpoint is `POST http://localhost:3001/mcp`. Legacy SSE clients can use `GET /sse`. Send the key as `X-API-Key: ...` or `Authorization: Bearer ...`.

Set `API_KEY` in production. If it is empty or absent, a cryptographically random key is generated for that process and printed once at startup. `npm run start:all` and the Docker image generate one shared key for the REST and MCP processes.

## `read_url`

| Parameter | Default | Purpose |
| --- | --- | --- |
| `url` | required | HTTP or HTTPS page URL |
| `format` | `markdown` | `markdown`, `text`, `html`, or original `raw_html` |
| `includeLinks` | `false` | Keep targets in Markdown or cleaned HTML |
| `maxCharacters` | `50000` | Hard output cap, including the truncation marker |

When output is shortened, the final line reports exactly how many source characters were omitted. Tool results also include structured metadata describing the source and truncation.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `API_KEY` | generated | Shared bearer/API key |
| `MCP_HOST` | `127.0.0.1` | MCP bind address (`0.0.0.0` in the Docker image) |
| `MCP_PORT` | `3001` | MCP port |
| `MCP_RATE_LIMIT_PER_SECOND` | `10` | Rolling global request limit |
| `MCP_MAX_OUTPUT_CHARACTERS` | `50000` | Default tool output cap |
| `MCP_ALLOWED_HOSTS` | unset | Comma-separated Host allowlist for DNS-rebinding protection |
| `FETCH_TIMEOUT_MS` | `15000` | Upstream page timeout |
| `MAX_DOWNLOAD_BYTES` | `5242880` | Maximum downloaded page size |

The server publishes tool title/description, input defaults, read-only/idempotent/open-world annotations, server instructions, and structured result metadata. `GET /healthz` is available for liveness checks.
