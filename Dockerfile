FROM node:22-bookworm-slim AS build

WORKDIR /app
ENV HUSKY=0

COPY package.json package-lock.json ./
COPY web/package.json web/package-lock.json ./web/
RUN npm ci

COPY . .
RUN npm run build

FROM docker:27-cli AS docker-cli

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV HUSKY=0

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=build /app/dist ./dist
COPY --from=build /app/web/dist ./web/dist
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/README.md /app/CHANGELOG.md /app/LICENSE ./

EXPOSE 10114

CMD ["node", "dist/cli/index.js", "start", "--no-open", "--host", "0.0.0.0"]
