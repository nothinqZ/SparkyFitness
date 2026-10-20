# Release publisher for the SparkyFitness sideload IPA. Build from the repo
# root so the shared IPA validator and the app icon can be copied in:
#   docker build -f deploy/ios-release-server/Dockerfile -t sparky-release-publisher .
FROM python:3.12-alpine@sha256:1b668429b3511ab407d8e00648891631b0b1a4d7e15e3ca70f38ab5b91ad4ab4

RUN addgroup -S -g 10001 release && adduser -S -u 10001 -G release release \
    && mkdir -p /data && chown release:release /data

WORKDIR /app
COPY scripts/ios/validate_ipa.py /app/validate_ipa.py
COPY deploy/ios-release-server/publisher/sparky_release.py /app/sparky_release.py
COPY SparkyFitnessMobile/assets/icons/appstore.png /app/icon.png

ENV DATA_DIR=/data PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
USER release
ENTRYPOINT ["python", "/app/sparky_release.py"]
CMD ["watch-github"]
