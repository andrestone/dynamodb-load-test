FROM alpine:3.11

RUN apk --update add npm
RUN npm install -g typescript && \
    npm install -g ts-node

COPY . /opt

WORKDIR /opt
