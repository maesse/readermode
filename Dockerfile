FROM node:22-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY *.js ./

# Default: run both the REST API (port 3000) and MCP server (port 3001)
# Override CMD to run only one if preferred.
ENV PORT=3000
ENV MCP_PORT=3001
ENV MCP_HOST=0.0.0.0
ENV API_KEY=

EXPOSE 3000 3001

# Run both servers in parallel
CMD ["node", "start-all.js"]
