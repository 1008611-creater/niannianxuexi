# DeepTutor public deployment

This directory contains the public reverse-proxy configuration for the
DeepTutor deployment at `tutor.cauai.fun`.

- `docker-compose.yml` remains the application source of truth.
- `docker-compose.override.yml` binds DeepTutor and PocketBase to loopback
  ports and adds Caddy on ports 80/443.
- `Caddyfile` terminates HTTPS and proxies to the frontend container.
- No model provider credentials belong in this directory.
- `release-record-20260807.md` records the current image digests, preserved data mounts, rollback labels, and verification boundary.

## Realtime voice pilot

The browser WebSocket path `/api/v1/realtime/*` is routed directly to the
FastAPI container. The provider credential is read only from the server-local
file `data/runtime/realtime.env`; use `realtime.env.example` as the template.
The file is ignored through `data/`, is never baked into the image, and is not
served by Caddy. Without it, students see the existing recording fallback.
