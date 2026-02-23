# Production Dockerfile for Voxa backend (Render)
# Base: Node 20 on Debian Bookworm Slim
FROM node:20-bookworm-slim

# Install ffmpeg for TTS MP3→WAV conversion (must be on PATH)
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies (package-lock.json required for npm ci)
COPY package.json package-lock.json ./
RUN npm ci

# Copy full backend source
COPY . .

# TypeScript build → dist/
RUN npm run build

# Remove devDependencies for smaller production image
RUN npm prune --production

EXPOSE 4000

# Render sets PORT; server uses process.env.PORT || 4000
ENV PORT=4000
CMD ["node", "dist/index.js"]
