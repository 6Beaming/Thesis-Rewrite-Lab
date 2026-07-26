# Production deployment runbook

This directory contains the reviewed deployment configuration. It does not make
server changes by itself.

## Architecture

- Host NGINX: public ports 80 and 443, TLS termination, WebSocket proxying
- `app` container: Node/Express and built React frontend on loopback port 3001
- `nlp` container: private FastAPI service on Docker-network port 8080
- `postgres` container: private PostgreSQL with a named persistent volume

The VM pulls immutable Node and NLP images built by GitHub Actions. It does not
clone the repository or install Node/Python packages on the host.

CI audits the installed Python environment. The CPU-only PyTorch wheel and the
spaCy language model are direct non-PyPI artifacts, so `pip-audit` reports them
as skipped while still failing on known findings in all auditable packages.

Local validation on 2026-07-26 measured approximately:

| Component | Image or steady memory |
| --- | --- |
| Node application image | 105 MB |
| NLP image | 570 MB |
| Node container | 83 MiB |
| NLP container | 373 MiB |
| PostgreSQL container | 39 MiB |

These are development-machine observations, not VM guarantees. Verify at least
2 GiB of available RAM plus adequate image/database disk space on the VM. Keep
swap as an emergency buffer, not as normal NLP working memory.

## Required one-time inputs

Before running anything on the VM:

1. Confirm SSH reaches the intended course VM and inventory its OS, CPU, RAM,
   disk, existing services, and public address.
2. Confirm both DNS names resolve to that VM.
3. Create `local/deployment/.env.production`, validate it, and transfer it to
   `/opt/thesis-rewriter/.env.production` with mode `0600`.
4. Generate a dedicated Ed25519 CI key pair. Install only its public half for
   the VM `deploy` user.
5. If the GHCR images are private, log the VM `deploy` user into GHCR using a
   token limited to `read:packages`.
6. Configure the GitHub `production` environment described below.

## Server bootstrap

Copy the tracked `deployment/` directory to the VM for the first bootstrap.
Run as root:

```bash
DEPLOY_PUBLIC_KEY_FILE=/root/deploy-ci.pub \
  bash deployment/scripts/bootstrap-server.sh
```

The script installs Docker from Docker's official Ubuntu repository, NGINX,
Certbot, and UFW; creates `/opt/thesis-rewriter`; creates the `deploy` user; and
installs the HTTP-only NGINX configuration.

Sign out and back in after group membership changes. Verify:

```bash
docker version
docker compose version
sudo nginx -t
sudo ufw status
```

Do not proceed if the VM inventory shows an unrelated existing application.

## Production environment

The production file must be:

```text
/opt/thesis-rewriter/.env.production
```

Validate names and production endpoints without printing values:

```bash
/opt/thesis-rewriter/deployment/scripts/validate-env.sh \
  /opt/thesis-rewriter/.env.production
```

The file must be owned by `deploy` and have mode `0600`.

`APP_IMAGE_REF` and `NLP_IMAGE_REF` provide initial/manual image references.
Automated deployments override them with the two digests published by the
successful workflow.

## First manual image deployment

Keep the repository variable `PRODUCTION_DEPLOY_ENABLED=false`. Publish the two
images through the workflow, authenticate the VM to GHCR when necessary, and
then run as `deploy`:

```bash
/opt/thesis-rewriter/deployment/scripts/deploy.sh \
  ghcr.io/utsc-cscc09-programming-on-the-web/project-thesis-rewriter@sha256:NODE_DIGEST \
  ghcr.io/utsc-cscc09-programming-on-the-web/project-thesis-rewriter-nlp@sha256:NLP_DIGEST
```

The deployment script locks deployment, pulls both images, starts PostgreSQL
and NLP, creates a compressed PostgreSQL backup, runs migrations, starts the
application, and checks both private health endpoints.

It never removes the PostgreSQL volume.

## TLS certificate

After DNS points to the VM, port 80 is reachable, and the HTTP NGINX
configuration is active, rehearse against Let's Encrypt staging:

```bash
sudo LETSENCRYPT_EMAIL=operator@example.com \
  LETSENCRYPT_STAGING=true \
  bash deployment/scripts/issue-certificate.sh
```

The rehearsal uses Certbot's dry-run/staging flow and does not install a
browser certificate. After it succeeds, issue the production certificate:

```bash
sudo LETSENCRYPT_EMAIL=operator@example.com \
  bash deployment/scripts/issue-certificate.sh
```

The script installs the HTTPS NGINX configuration, validates NGINX, installs a
renewal deploy hook, and runs `certbot renew --dry-run`.

## GitHub environment

Create an environment named `production`, restricted to `main`.

Environment variables:

| Name | Value |
| --- | --- |
| `DEPLOY_HOST` | `project-thesis-rewriter.amazingcloud.space` |
| `DEPLOY_PORT` | `22` |
| `DEPLOY_USER` | `deploy` |
| `PUBLIC_APP_ORIGIN` | `https://thesis-rewrite-lab.erfang.win` |

Environment secrets:

| Name | Value |
| --- | --- |
| `DEPLOY_SSH_PRIVATE_KEY` | Complete dedicated CI private key |
| `DEPLOY_SSH_KNOWN_HOSTS` | Out-of-band verified host-key entry |

Repository variable:

| Name | Initial value |
| --- | --- |
| `PRODUCTION_DEPLOY_ENABLED` | `false` |

After the first manual deployment, HTTPS checks, integrations, VM reboot test,
and rollback test all pass, change `PRODUCTION_DEPLOY_ENABLED` to `true`.

No GitHub repository Deploy Key is required because the VM does not clone the
repository.

## Rollback

Restore the previously recorded Node/NLP image pair:

```bash
/opt/thesis-rewriter/deployment/scripts/rollback.sh
```

This does not reverse migrations or restore database data. Database restoration
from `backups/postgres-*.sql.gz` is a separate disaster-recovery operation and
must be explicitly approved.

## External provider updates

- Google OAuth origin:
  `https://thesis-rewrite-lab.erfang.win`
- Google OAuth callback:
  `https://thesis-rewrite-lab.erfang.win/auth/callback/google`
- Stripe webhook:
  `https://thesis-rewrite-lab.erfang.win/api/stripe/webhook`

The Stripe webhook secret in production must belong to that registered HTTPS
endpoint. A Stripe CLI listener secret is not interchangeable with it.
