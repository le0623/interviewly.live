#!/bin/sh

DOMAIN="interviewly.live"
EMAIL="${SSL_EMAIL:-admin@${DOMAIN}}"
LETSENCRYPT_DIR="/etc/letsencrypt"
LIVE_DIR="${LETSENCRYPT_DIR}/live/${DOMAIN}"
FULLCHAIN="${LIVE_DIR}/fullchain.pem"
PRIVKEY="${LIVE_DIR}/privkey.pem"

# Create necessary directories
mkdir -p /var/www/certbot
mkdir -p "${LETSENCRYPT_DIR}"

# Check if certificates already exist
if [ -f "${FULLCHAIN}" ] && [ -f "${PRIVKEY}" ]; then
    echo "SSL certificates already exist for ${DOMAIN}"
    echo "Certificate: ${FULLCHAIN}"
    echo "Private Key: ${PRIVKEY}"
    echo "Skipping certificate generation..."
    exit 0
fi

echo "SSL certificates not found. Generating new certificates for ${DOMAIN} using certbot..."

# Make sure nginx is not running (certbot standalone needs port 80)
if pgrep -x nginx > /dev/null; then
    echo "Stopping nginx temporarily for certificate generation..."
    nginx -s quit
    sleep 2
fi

# Obtain certificate using certbot standalone mode
# This will use HTTP-01 challenge on port 80 (certbot runs its own web server)
certbot certonly \
    --standalone \
    --non-interactive \
    --agree-tos \
    --email "${EMAIL}" \
    -d "${DOMAIN}" \
    -d "www.${DOMAIN}" \
    --preferred-challenges http \
    --keep-until-expiring

# Check if certificate was obtained successfully
if [ -f "${FULLCHAIN}" ] && [ -f "${PRIVKEY}" ]; then
    echo "SSL certificates generated successfully!"
    echo "Certificate: ${FULLCHAIN}"
    echo "Private Key: ${PRIVKEY}"
else
    echo "ERROR: Failed to generate SSL certificates"
    exit 1
fi
