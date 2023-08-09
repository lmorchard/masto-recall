FROM node:18

VOLUME ["/data"]

ARG PORT=8089

ENV HOST=0.0.0.0
ENV PORT=${PORT}
ENV BOT_NAME=MastoRecall

ENV DATABASE_PATH=/data/main.sqlite3

ENV STREAM_TOPIC=public
ENV STREAMING_API_URL=wss://streaming.mastodon.social/api/v1/streaming

ENV CLIENT_ID=setme
ENV CLIENT_SECRET=setme
ENV ACCESS_TOKEN=setme

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

EXPOSE ${PORT}
CMD ["node", "index.js", "start"]
