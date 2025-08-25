FROM node:22-alpine

WORKDIR /app

COPY ./package.json /app/package.json
COPY ./ /app/

RUN yarn

ENV NODE_ENV="production"

CMD ["yarn", "start"]


