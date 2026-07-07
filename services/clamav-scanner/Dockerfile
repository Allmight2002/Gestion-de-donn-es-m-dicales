FROM node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2

WORKDIR /app
COPY server.mjs ./

USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
