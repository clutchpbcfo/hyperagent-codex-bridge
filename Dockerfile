FROM node:22-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --chown=node:node src ./src
RUN mkdir /state && chown node:node /state

USER node
ENV HACB_HOME=/state
VOLUME ["/state"]
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:47831/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "src/cli.mjs", "serve"]
