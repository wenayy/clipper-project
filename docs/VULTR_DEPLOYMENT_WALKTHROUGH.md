# KlipCut on Vultr: deployment walkthrough

This document explains how the current deployment is connected, what each service does, the problems we found, and how we diagnosed them. It avoids storing any passwords, API keys, or private keys.

## The setup at a glance

The app uses three providers for different jobs:

| Part | What it does |
|---|---|
| Vercel | Builds and serves the React frontend at `https://klipcut.gitflex.lol`. |
| Vultr | Runs the API, a background video worker, PostgreSQL, and an Nginx HTTPS gateway using Docker Compose. |
| Cloudflare | Hosts DNS for `gitflex.lol` and proxies traffic for `api.gitflex.lol` to the Vultr server. |
| Cloudflare R2 | Stores video and job files so the API and worker can both access them. |
| JoyProxy | Supplies an outbound residential proxy for the backend's YouTube download requests. |

The browser flow is:

```text
Browser ── HTTPS ──▶ Vercel frontend (klipcut.gitflex.lol)
   │
   └── HTTPS API calls ──▶ Cloudflare ── HTTPS ──▶ Vultr Nginx
                                                    │
                                                    └── Docker network ──▶ API
                                                                             │
                                                                             ├── PostgreSQL
                                                                             ├── R2 for shared video files
                                                                             └── JoyProxy for YouTube downloads
                                                                      Worker ◀┘
```

## What each address means

- `klipcut.gitflex.lol` is the public frontend address. Vercel serves this site.
- `api.gitflex.lol` is the public API address. Its Cloudflare DNS `A` record points to the Vultr server's public IP. With the orange cloud enabled, browsers connect to Cloudflare first; Cloudflare then connects to Vultr.
- The Vultr IP is the server address. It is not the JoyProxy address.
- `gate.joyproxy.com:9001` is JoyProxy's outbound proxy gateway. It belongs in the backend environment setting `CLIPPER_PROXY`, never in Cloudflare DNS.

The Vercel production variable is:

```dotenv
VITE_API_BASE=https://api.gitflex.lol/api
```

Vite embeds `VITE_API_BASE` into the frontend during its build, so redeploy the Vercel project after changing it.

## How the Docker deployment works

The Compose configuration lives in `deploy/aws/` (the folder name is historical; it can run on Vultr). On the server it was cloned under `~/clipper_local2`, so the deployment directory is:

```bash
cd ~/clipper_local2/deploy/aws
```

The containers are:

- **db**: PostgreSQL stores account, job, and queue data. The named `pgdata` volume keeps that database across container restarts.
- **api**: FastAPI handles login, job submission, and other API calls. The deployment entry point `backend/server.py` mounts the application under `/api`, which is why the frontend base URL ends in `/api`.
- **worker**: claims queued jobs from PostgreSQL and downloads, transcribes, analyzes, and renders video in the background.
- **frontend**: despite the service name, this container is the Nginx gateway in this layout. Vercel serves the actual public React site. Nginx accepts HTTP/HTTPS traffic on Vultr and forwards `/api/...` requests to the API container.

Both API and worker read `deploy/aws/.env`. Compose also builds their `DATABASE_URL` from `POSTGRES_PASSWORD`. `STORAGE_BACKEND=r2` and the `R2_*` values let the separate API and worker containers share source videos and results. Without shared storage, a worker could save a file on its own disk that the API cannot serve.

Useful commands from `deploy/aws/`:

```bash
docker compose ps
docker compose logs --tail=100 api worker frontend
docker compose up -d --build
```

After editing environment values, recreate the containers that use them:

```bash
docker compose up -d --force-recreate api worker
```

## JoyProxy and YouTube downloads

Vultr is a datacenter host. YouTube may challenge or block downloads that appear to come directly from a datacenter IP. JoyProxy provides a residential network exit for those outbound requests. The app's downloader reads `CLIPPER_PROXY` and passes it to yt-dlp when it fetches media. It does not proxy ordinary browser traffic, the API domain, or Cloudflare.

JoyProxy's endpoint generator returns an authenticated connection in this shape:

```text
generated-username:generated-password@gate.joyproxy.com:9001
```

For the rotating residential endpoint, use the **entire generated username** (including its session options such as `sessid` and `sesstime`), not only the base account username. Add the HTTP scheme and put it in the server `.env`:

```dotenv
CLIPPER_PROXY=http://FULL_GENERATED_USERNAME:PROXY_PASSWORD@gate.joyproxy.com:9001
```

The generated username controls the JoyProxy session behavior. A sticky session tends to keep an exit IP for its selected duration; a rotating session changes the exit IP according to JoyProxy's behavior. In the setup shown, the generated endpoint selected a 30-minute session. These are JoyProxy settings, independent of DNS and TLS.

Credentials have been exposed in screenshots and chat text during setup. Regenerate the JoyProxy password in its dashboard, then update the `.env` value. Do not put proxy credentials in Vercel, frontend source code, Cloudflare DNS, or a public repository.

## HTTPS, TLS, and the origin certificate

TLS is the encryption used by HTTPS. There are two HTTPS connections in this proxied setup:

1. The browser connects to Cloudflare, which presents the public certificate for `api.gitflex.lol`.
2. Cloudflare connects from its edge to Nginx on Vultr. Nginx presents a **Cloudflare Origin Certificate** for the backend hostname.

The Origin Certificate is for the Cloudflare-to-server connection; browsers normally do not trust it directly. Cloudflare SSL/TLS mode should be **Full (strict)**, and the origin certificate must cover `api.gitflex.lol`. Nginx's config reads the certificate from `deploy/aws/certs/origin.pem` and its matching private key from `deploy/aws/certs/origin.key`.

PEM files are text files with exact boundary lines, for example:

```text
-----BEGIN CERTIFICATE-----
...certificate data...
-----END CERTIFICATE-----
```

The private key is a separate PEM block in `origin.key`. Keep the certificate and private key in separate files, preserve the complete `BEGIN`/`END` lines, and do not add quotation marks or explanatory text. Validate them on the server without printing the private key:

```bash
openssl x509 -in certs/origin.pem -noout -subject
openssl pkey -in certs/origin.key -noout
```

The certificate files were initially malformed, so Nginx exited immediately with `PEM_read_bio_X509_AUX() failed` / `bad end line`. That made the `frontend` gateway container restart repeatedly and left nothing listening on public HTTPS port 443. Once valid PEM files were installed, both OpenSSL checks passed and this local request returned HTTP 200:

```bash
curl -ki https://localhost/api/health
```

The matching private key was subsequently pasted into chat. Treat it as compromised: create a new Origin Certificate in Cloudflare, replace **both** files with the new matching pair, and restart the gateway. Never paste the replacement private key into chat.

## Problems we found and how we diagnosed them

### Public API returned 503

`docker compose ps` showed the API was running and PostgreSQL was healthy, but the Nginx gateway was `Restarting`. The Nginx logs named the malformed origin certificate. The API itself answered `http://localhost:8000/healthz` with `{"ok":true}`, which isolated the problem to the HTTPS gateway rather than the API. After fixing the certificate, Nginx proxied `/api/health` locally and returned HTTP 200.

The health body was:

```json
{"ok":true,"queue":{"waiting":0,"running":0,"total":0},"inline_worker":false,"storage":"r2"}
```

This confirms the API is alive, the worker-split mode is on, and R2 is configured. It does not by itself prove JoyProxy can download a particular YouTube video.

### Login and signup failed in the browser

After the API responded, the browser showed `Failed to fetch`; developer tools showed the login request's **CORS preflight** returned HTTP 400. Before sending a cross-origin login request, browsers send an `OPTIONS` preflight request asking whether the API permits the frontend's origin and request headers. The backend's `CLIPPER_CORS_ORIGINS` setting was missing, so it used localhost-only development origins and did not allow the deployed Vercel custom domain.

Add the exact frontend origin to `deploy/aws/.env` (scheme and hostname only, no path or trailing slash):

```dotenv
CLIPPER_CORS_ORIGINS=https://klipcut.gitflex.lol
```

If people also use the Vercel `*.vercel.app` production address, allow both origins as a comma-separated value. Then recreate the API and worker so they load the new environment:

```bash
docker compose up -d --force-recreate api worker
```

This CORS change was recommended after the preflight failure; verify it by refreshing the frontend and checking that the `OPTIONS` preflight succeeds before testing login. `CLIPPER_APP_ORIGIN` is used for app/billing return links and does not substitute for `CLIPPER_CORS_ORIGINS`.

## Verify the full route

On Vultr, from `deploy/aws/`:

```bash
docker compose ps
curl -i http://localhost:8000/healthz
curl -ki https://localhost/api/health
```

From your own computer, test the Cloudflare hostname:

```bash
curl -i https://api.gitflex.lol/api/health
```

Then open `https://klipcut.gitflex.lol`, attempt login, and inspect the browser Network panel. The login `OPTIONS` request should succeed; if it still returns 400, check the request's `Origin` header and make `CLIPPER_CORS_ORIGINS` match it exactly. If the public curl fails while the local HTTPS curl succeeds, inspect the Cloudflare DNS record, proxy setting, SSL mode, and the Vultr firewall's inbound 443 rule.

## Security cleanup

Several live credentials appeared in screenshots or chat messages: JoyProxy credentials, the Cloudflare Origin private key, the Postgres password, and `CLIPPER_SECRET_KEY`. Replace them before treating this deployment as secure:

1. **JoyProxy:** regenerate the password and update `CLIPPER_PROXY` in `.env`.
2. **Cloudflare Origin Certificate:** issue a new pair, replace both PEM files, and restart the Nginx gateway (`docker compose up -d --force-recreate frontend`).
3. **Application secret:** generate a new random `CLIPPER_SECRET_KEY` and recreate API/worker. Existing login tokens signed with the old secret will no longer validate, so users may need to sign in again.
4. **Postgres password:** change the actual database role password as well as `POSTGRES_PASSWORD` in `.env`. Changing only the Compose environment value does not change the password inside an already initialized Postgres data volume. Use an interactive database session and PostgreSQL's `\password klipcut` command so the new password is not placed directly in shell history. Update `.env`, then recreate API and worker promptly because Compose uses that value to build their database connection string.

Do not commit `deploy/aws/.env`, `deploy/aws/certs/origin.key`, or any other secret file to Git. If any secrets were pushed to a repository, rotate them even if the repository was later made private or the files were deleted.
