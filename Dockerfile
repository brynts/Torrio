FROM node:20-alpine

# Install nginx
RUN apk add --no-cache nginx

# Copy aplikasi
COPY . /app
WORKDIR /app

# Copy nginx config
COPY nginx.conf /etc/nginx/http.d/default.conf

# Copy startup script
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost || exit 1

CMD ["/docker-entrypoint.sh"]
