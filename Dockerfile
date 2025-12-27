FROM node:20-bookworm-slim

WORKDIR /app

# Copy only package.json first
COPY package.json ./

# Generate lockfile + install deps inside container
RUN npm install --omit=dev

# Copy bot code
COPY index.js ./

CMD ["node", "index.js"]
