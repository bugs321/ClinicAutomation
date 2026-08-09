# Playwright's official image ships Chromium + all the system libraries it
# needs already installed. This matters on Render: its native Node
# buildpack can't run `apt-get` during build (no root), so `playwright
# install --with-deps` fails there. Deploying as a Docker service instead
# sidesteps that entirely.
FROM mcr.microsoft.com/playwright:v1.46.0-jammy

WORKDIR /app

# The base image already has Chromium + deps installed; skip
# package.json's postinstall re-download/apt step during this build.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# Render sets $PORT itself; server/index.js already reads process.env.PORT.
EXPOSE 8787

CMD ["node", "server/index.js"]
