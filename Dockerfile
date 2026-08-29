FROM node:25-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev=false
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc
ENV PORT=8080
EXPOSE 8080
CMD ["node", "dist/server.js"]
