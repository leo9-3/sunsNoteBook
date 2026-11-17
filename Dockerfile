FROM node:22-alpine
WORKDIR /app
COPY package.json server.js ./
COPY public ./public
RUN mkdir -p /app/data
ENV PORT=4173 HOST=0.0.0.0
EXPOSE 4173
VOLUME ["/app/data"]
CMD ["node","server.js"]
