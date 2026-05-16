FROM nginx:1.27-alpine
RUN printf '%s\n' '<!doctype html><title>Cheeky Pony frontend placeholder</title><h1>Cheeky Pony</h1>' > /usr/share/nginx/html/index.html
