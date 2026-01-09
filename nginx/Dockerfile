FROM nginx:alpine

# Install certbot and openssl for SSL certificate generation
RUN apk add --no-cache certbot certbot-nginx openssl

# Copy nginx configuration
COPY nginx/nginx.conf /etc/nginx/nginx.conf
COPY nginx/default.conf /etc/nginx/conf.d/default.conf

# Copy SSL generation script
COPY nginx/generate-ssl.sh /usr/local/bin/generate-ssl.sh
RUN chmod +x /usr/local/bin/generate-ssl.sh

# Create directory for SSL certificates
RUN mkdir -p /etc/nginx/ssl

# Run SSL generation script on container start
CMD ["/bin/sh", "-c", "/usr/local/bin/generate-ssl.sh && nginx -g 'daemon off;'"]
