FROM mcr.microsoft.com/devcontainers/javascript-node:1-24-bookworm

ARG FLUTTER_VERSION=3.47.9
ARG FLUTTER_ARCHIVE_SHA256=25ed8c3c29d51a7353f2a944310b478af8214920639524b19c50a19e6c044c5a

ENV FLUTTER_HOME=/opt/flutter
ENV PATH="${FLUTTER_HOME}/bin:${PATH}"

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        libglu1-mesa \
        unzip \
        xz-utils \
        zip \
    && rm -rf /var/lib/apt/lists/* \
    && curl --fail --location --silent --show-error \
        "https://storage.googleapis.com/flutter_infra_release/releases/stable/linux/flutter_linux_${FLUTTER_VERSION}-stable.tar.xz" \
        --output /tmp/flutter.tar.xz \
    && echo "${FLUTTER_ARCHIVE_SHA256}  /tmp/flutter.tar.xz" | sha256sum --check --status \
    && tar -xJf /tmp/flutter.tar.xz -C /opt \
    && rm /tmp/flutter.tar.xz \
    && chown -R node:node "${FLUTTER_HOME}"
