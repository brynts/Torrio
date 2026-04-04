FROM node:20-alpine
WORKDIR /app
COPY . /app
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost || exit 1
CMD ["node", "server.js"]