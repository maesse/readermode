FROM node:24-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY --chown=node:node src ./src

# Default: run both the REST API (port 3000) and MCP server (port 3001)
# Override CMD to run only one if preferred.
ENV PORT=3000
ENV MCP_PORT=3001
ENV MCP_HOST=0.0.0.0
ENV NODE_ENV=production

EXPOSE 3000 3001

USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "Promise.all([3000,3001].map(port=>fetch('http://127.0.0.1:'+port+'/healthz').then(response=>{if(!response.ok)throw new Error(String(response.status))}))).catch(()=>process.exit(1))"]

# Run both servers in parallel
CMD ["node", "src/start-all.js"]
