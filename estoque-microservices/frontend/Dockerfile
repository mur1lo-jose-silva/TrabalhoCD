# Front end estatico servido por Nginx.
# Fica atras do mesmo gateway (Traefik) que as APIs, entao a UI chama
# /produtos e /movimentacoes na mesma origem (sem problema de CORS).
FROM nginx:1.27-alpine
COPY index.html /usr/share/nginx/html/index.html
EXPOSE 80
