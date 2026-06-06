# Same as repo-root Dockerfile — for repos that commit .cursor/ alongside manual upload.

FROM node:20-bookworm-slim

ARG PNPM_VERSION=9.15.4
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip build-essential git sudo \
  && rm -rf /var/lib/apt/lists/* \
  && ln -sf python3 /usr/bin/python

RUN id -u ubuntu >/dev/null 2>&1 || useradd -m -s /bin/bash ubuntu \
  && usermod -aG sudo ubuntu \
  && echo "ubuntu ALL=(ALL) NOPASSWD:ALL" >/etc/sudoers.d/ubuntu \
  && chmod 0440 /etc/sudoers.d/ubuntu

RUN corepack enable && corepack prepare "pnpm@${PNPM_VERSION}" --activate

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc turbo.json /workspace/
COPY packages /workspace/packages
COPY apps/core /workspace/apps/core

RUN pnpm install --frozen-lockfile \
  && pnpm test:coverage \
  && chown -R ubuntu:ubuntu /workspace

USER ubuntu
