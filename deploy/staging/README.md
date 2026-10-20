# Staging instance

Runs the personal edition next to an existing SparkyFitness on the same host,
with its own containers (`sparky-next-*`), network and empty database. Nothing
is shared with production.

```bash
cd deploy/staging
./init-env.sh                 # once; random secrets in .env (gitignored)
docker compose up -d
docker compose logs -f next-server
```

It listens on `127.0.0.1:3104` only. From your workstation:

```bash
ssh -L 3104:127.0.0.1:3104 <homelab-host>
# then open http://localhost:3104 and register (the first account is yours)
```

`SPARKY_FITNESS_FRONTEND_URL` in `.env` must match the address in the browser
(sign-in checks the origin). To serve it under a real hostname instead, put it
behind your reverse proxy and set that URL, e.g. in Caddy:

```caddy
@fitness_next host fitness-next.example.com
reverse_proxy @fitness_next sparky-next-next-frontend-1:80
```

(the proxy container must share a Docker network with `next-frontend`;
`docker-compose.proxy.yml` joins it to `PROXY_NETWORK`, default
`proxy_health`, under the alias `sparky-next-frontend`):

```bash
docker compose -f docker-compose.yml -f docker-compose.proxy.yml up -d
```

Sign-up is open until you set `SPARKY_FITNESS_DISABLE_SIGNUP=true` in `.env`
and recreate `next-server`; do that after creating your account.

Images default to `sparkyfitness-server:personal-rc` and
`sparkyfitness-frontend:personal-rc`; override with `SERVER_IMAGE` /
`FRONTEND_IMAGE`. Remove everything, including data:
`docker compose down -v`.
