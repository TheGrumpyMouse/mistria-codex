# mistria-sync

One progress blob per device code, on Cloudflare Workers + KV.

The merge is **not** here — it runs on the client, in `@mistria/sync-client` and
`apps/web/src/lib/sync.ts`. This Worker is storage with an etag. That keeps the
CRDT in one property-tested place, keeps CPU trivially inside the free tier, and
means a merge bug is fixed by shipping the app rather than by redeploying.

**Anyone with a code can read and change that progress.** There are no accounts.
The settings panel says so next to the code, and any deployment of this should
keep saying it.

---

## Deploying

Everything below is done once, on your own Cloudflare account. Nothing in CI
touches Cloudflare.

### 1. Log in

```sh
pnpm dlx wrangler login
```

### 2. Create the KV namespace

```sh
cd workers/sync
pnpm dlx wrangler kv namespace create PROGRESS
```

It prints an id. Put it in `wrangler.toml`, replacing
`replace-me-after-wrangler-kv-namespace-create`:

```toml
[[kv_namespaces]]
binding = "PROGRESS"
id = "the-id-it-printed"
```

That id is not a secret — it is meaningless without your account credentials —
so committing it is fine.

### 3. Set the allowed origins

The Worker accepts writes, so its CORS allowlist is **never `*`**: with a
wildcard, any page anyone visits could alter their progress in the background.
List the exact origins that may talk to it.

```toml
[vars]
ALLOWED_ORIGINS = "https://<your-github-username>.github.io"
```

Add `http://localhost:5173` too if you want sync to work in `pnpm dev`.
Origins are scheme + host, with no path and no trailing slash — the Pages
project path (`/mistria-codex/`) is not part of an origin and including it means
nothing will ever match.

### 4. Deploy

```sh
pnpm dlx wrangler deploy
```

It prints the URL, something like
`https://mistria-sync.<your-subdomain>.workers.dev`. Check it:

```sh
curl https://mistria-sync.<your-subdomain>.workers.dev/v1/health
# {"ok":true}
```

### 5. Point the app at it

The app reads `VITE_SYNC_URL` at **build** time. It is deliberately not a
setting someone can type in: a URL a user can enter is a URL an attacker can
talk them into entering, and the whole privacy claim of this app is that nothing
leaves the device unless you ask.

In GitHub: **Settings → Secrets and variables → Actions → Variables → New
repository variable**

| Name | Value |
| --- | --- |
| `VITE_SYNC_URL` | `https://mistria-sync.<your-subdomain>.workers.dev` |

A *variable*, not a secret — it is baked into a public bundle, so treating it as
a secret would be theatre.

Locally:

```sh
VITE_SYNC_URL=https://mistria-sync.<your-subdomain>.workers.dev pnpm dev
```

Leave it unset and the app builds and runs with sync switched off, and the
settings panel says so rather than offering a button that cannot work.

### 6. Try it

Open **Settings** → **Create a code** on one device, type that code into the
other, and press **Sync now** on both. Tick something different on each first —
the point is that both survive. A merge is commutative, so the order does not
matter and syncing twice changes nothing.

---

## The free tier, and why the code is shaped like this

Cloudflare's free plan allows **1,000 KV writes a day**. Three decisions come
straight from that number, and undoing any of them will burn through it:

- **The client generates its own code.** No `POST /codes`, so handing one out
  costs no write and works offline.
- **A `PUT` that would store identical bytes is answered without writing.** A
  client syncing on every visibility change would otherwise spend a write each
  time to store what is already there.
- **The merge runs on the client**, so the Worker never reads-modifies-writes.

Rate limiting uses Cloudflare's own binding rather than a counter in KV, for the
same reason: counting requests in KV would cost a write per request.

## Costs

Nothing, at any plausible scale for this app. Workers free tier is 100,000
requests a day; KV free tier is 100,000 reads and 1,000 writes. A person
syncing two devices a few times an evening uses single-digit writes.
