FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
ARG VITE_SETTLE_API_URL=http://localhost:4000
ENV VITE_SETTLE_API_URL=$VITE_SETTLE_API_URL
RUN npm run build
FROM node:22-alpine AS runtime
WORKDIR /app
RUN npm install --global vite@6.4.1
COPY --from=build /app/dist ./dist
ENV PORT=3000
EXPOSE 3000
CMD ["vite","preview","--host","0.0.0.0","--port","3000","--strictPort"]
