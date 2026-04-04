FROM nginx:alpine

# Install PHP-FPM
RUN apk add --no-cache php82-fpm && \
    sed -i 's/listen = 127.0.0.1:9000/listen = 9000/' /etc/php82/php-fpm.d/www.conf && \
    sed -i 's/;catch_workers_output = yes/catch_workers_output = yes/' /etc/php82/php-fpm.d/www.conf

COPY . /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

# Start both nginx and php-fpm
CMD ["sh", "-c", "php-fpm82 -D && nginx -g 'daemon off;'"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost || exit 1
