FROM node:22-alpine
WORKDIR /app
COPY index.html styles.css app.js server.mjs ./
ENV FRONTEND_PORT=3000
EXPOSE 3000
USER node
CMD ["node", "server.mjs"]
