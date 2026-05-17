# Security-hardened nginx image for serving the Cheeky Pony frontend.
#
# Still a "placeholder" in that it doesn't actually build the Vite
# bundle — the real production image will COPY the output of
# `pnpm --filter @cheeky-pony/frontend build` here. The two
# hardening properties we DO want from day one are:
#
#  - non-root: nginx master runs as the unprivileged `nginx` user
#    (UID 101) from the upstream image, not root. We rebind the
#    listen port to 8080 (>1024) so the user can bind without
#    CAP_NET_BIND_SERVICE.
#  - strict response headers: see infra/frontend/nginx.conf — CSP,
#    `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
#    `Permissions-Policy`, `frame-ancestors 'none'` (CSP) +
#    legacy `X-Frame-Options: DENY`.
#
# The placeholder body is the same one-liner the previous image
# served; swap the COPY line in once the real frontend bundle lands.

FROM nginx:1.27-alpine

# Replace the distro default config with our hardened version.
RUN rm /etc/nginx/conf.d/default.conf
COPY infra/frontend/nginx.conf /etc/nginx/nginx.conf

# Pre-create writable paths under /tmp so the unprivileged user can
# open them. /var/cache/nginx is already chowned to `nginx` in the
# upstream image; /tmp is world-writable.
RUN mkdir -p /tmp/nginx-client-body /tmp/nginx-proxy /tmp/nginx-fastcgi \
             /tmp/nginx-uwsgi /tmp/nginx-scgi \
 && chown -R nginx:nginx /tmp/nginx-* /usr/share/nginx/html /var/cache/nginx

# Placeholder body — replace with the built Vite bundle.
RUN printf '%s\n' '<!doctype html><title>Cheeky Pony frontend placeholder</title><h1>Cheeky Pony</h1>' \
    > /usr/share/nginx/html/index.html \
 && chown nginx:nginx /usr/share/nginx/html/index.html

EXPOSE 8080

# Run as the unprivileged nginx user. PID 1 is the master process.
USER nginx
CMD ["nginx", "-g", "daemon off;"]
