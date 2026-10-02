# Postgres 17 + PostGIS 3 + pgvector, from the PGDG apt repository the official image already configures.
# (postgis/postgis publishes no arm64 image, so it would not run on Apple Silicon dev machines.)
FROM postgres:17-bookworm
RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-17-postgis-3 postgresql-17-pgvector \
 && rm -rf /var/lib/apt/lists/*
