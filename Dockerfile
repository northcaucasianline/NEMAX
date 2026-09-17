FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3001 REALTIME_PORT=3002 HOST=0.0.0.0 REALTIME_HOST=0.0.0.0
COPY package.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
RUN addgroup -g 20000 codebridge && addgroup node codebridge \
  && mkdir -p server/data server/uploads server/tmp && chown -R node:node /app
EXPOSE 3001 3002 3004 3005
USER node
CMD ["node", "server/start.js"]
