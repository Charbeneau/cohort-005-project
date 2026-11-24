# Hosted notification vendors: Knock vs Novu vs MagicBell vs Courier

Research for issue #4 (child of map #2, "Wayfinder: In-app Notifications"). Gathered 2026-11-23 from official pricing pages, official docs, and the vendors' published npm packages. This doc does **not** pick a vendor; a later grilling ticket does that.

Cadence context: React Router 8 (framework mode, SSR) + React 19, SQLite/Drizzle, transactional email already sent through Postmark (`app/lib/mailer.server.ts`, which falls back to `.outbox/` JSON files when no token is set).

## Comparison table

| | Knock | Novu | MagicBell | Courier |
|---|---|---|---|---|
| **Free tier** | $0: 10,000 messages/mo, unlimited users and channels, Knock branding | $0: 10,000 workflow runs/mo, 5 workflows, 2 envs, 3 team members, 24h activity retention | $0 "Builder": 1,000 deliveries/mo, unlimited users | $0 "Developer": 10,000 sends/mo |
| **First paid tier** | Starter $250/mo (50k msgs, then $0.005) | Pro from $30/mo (30k runs, then $1.20/1k) | Startup $249/mo (50k deliveries, then $0.0025) | Business: pay as you go at $0.005/send |
| **React package** | `@knocklabs/react` 0.15.1 | `@novu/react` 3.21.0 | `@magicbell/react` 1.14.0 | `@trycourier/courier-react` 9.3.5 |
| **React 19 peer dep** | Yes (`^17 \|\| ^18 \|\| ^19`) | Yes (`^18 \|\| ^19`) | None declared | Yes (`>=18`) |
| **Secure user identity** | Server-signed **RS256 JWT** (`sub` = user id) using a Knock signing key ("enhanced security mode") | **HMAC-SHA256**(secret key, subscriberId) passed as `subscriberHash` | Server-signed **HS256 JWT** (`user_external_id`/`user_email` + `api_key`) using the project secret key | **JWT issued by Courier's API** (server calls Issue Token with scopes `user_id:<id> inbox:read:messages inbox:write:events`) |
| **Real-time** | WebSocket (Phoenix channels) | WebSocket (socket.io / partysocket) | WebSocket (`wss://ws.magicbell.com`) | WebSocket (`wss://realtime.courier.io`) |
| **Email channel** | Yes | Yes | Yes | Yes |
| **Route via Postmark** | Yes, first-party Postmark integration | Yes, first-party Postmark integration | No Postmark integration listed; generic SMTP provider (Postmark offers SMTP) is the only path | Yes, first-party Postmark integration |
| **Local dev / tests without keys** | No keyless mode; separate dev environment with its own keys; no self-host | Keyless Inbox (24h throwaway data); open-source MIT core is self-hostable (Docker; heavy: Mongo + Redis + S3) | No test mode or self-host documented | Separate Test environment with Test API keys and simulated sends; no self-host |

In every case the automated-test story for Cadence's own code is the same: put the vendor behind a thin server module (like `mailer.server.ts` does for Postmark) and fake it in tests. Only Novu offers a way to run the real backend locally.

## Knock

- **Pricing.** Free: up to 10,000 messages/mo, unlimited stored users, team members, channels and workflows. Free excludes removing Knock branding. Starter is $250/mo with 50,000 messages, then $0.005/message. Source: https://knock.app/pricing
- **React component.** `@knocklabs/react` ships `KnockProvider`, `KnockFeedProvider`, `NotificationIconButton`, `NotificationFeedPopover`, `NotificationFeed`. Required: public `apiKey`, `user.id`, `feedId`. Sources: https://docs.knock.app/in-app-ui/react/overview, https://docs.knock.app/in-app-ui/react/feed
  - npm (v0.15.1, modified 2026-11-06): peer deps `react`/`react-dom` `^17 || ^18 || ^19`; optional peer deps `next` and `@tanstack/react-router`. The ESM entry carries a `"use client"` directive. Source: `npm view @knocklabs/react`, https://www.npmjs.com/package/@knocklabs/react
- **User identity.** With enhanced security mode on, Knock rejects client requests that don't include a signed user token. The backend signs a JWT with **RS256** using the private signing key (`KNOCK_SIGNING_KEY`). `sub` = user id is required; `iat`/`exp` are recommended. Pass it via `userToken`; `onUserTokenExpiring` lets you refresh it. Without enhanced security, "feeds are accessible to anyone with the feed ID." Source: https://docs.knock.app/in-app-ui/security-and-authentication
- **Real-time.** The docs describe a "real-time feed" and socket tuning (`auto_manage_socket_connection`). `@knocklabs/client` depends on `phoenix` 1.8.9, so the transport is Phoenix-channel WebSockets. Sources: https://docs.knock.app/in-app-ui/react/feed, `npm view @knocklabs/client dependencies`
- **Email / Postmark.** First-party Postmark integration: configure the Postmark server API key per environment. It sends to the `outbound` stream by default, and you can override `MessageStream` in the payload. Source: https://docs.knock.app/integrations/email/postmark
- **Local dev / tests.** Production plus an optional development environment (and custom ones). Each has isolated data, its own API keys, and its own channel credentials. The docs mention no test mode, sandbox, keyless mode, or self-host option. Source: https://docs.knock.app/concepts/environments

## Novu

- **Pricing.** Free: 10,000 workflow runs/mo, unlimited subscribers, 24h activity feed retention, 60 events/sec, 5 workflows, 2 environments (Dev + Prod), up to 3 team members, all channels (email, in-app, SMS, chat, push). Pro from $30/mo (30k runs, then $1.20/1k, 20 workflows, 7-day retention). Team from $250/mo. On the pricing page, self-hosting appears only under Enterprise. Source: https://novu.co/pricing
- **React component.** `@novu/react` (`<Inbox />`); `@novu/nextjs` for Next. Props: `applicationIdentifier`, `subscriber` (or `subscriberId`), and `routerPush={(path) => navigate(path)}` to hook up React Router navigation. "`@novu/react` requires React 18 or later", supporting `^18.0.0` and `^19.0.0`. Source: https://docs.novu.co/platform/inbox/react/get-started
  - npm (v3.21.0, modified 2026-11-23): peer deps `react`/`react-dom` `^18 || ^19`. The UI is built in Solid (`@novu/js` depends on `solid-js`) and wrapped for React. Source: `npm view @novu/react`, `npm view @novu/js`
- **User identity.** HMAC: `subscriberHash = HMAC-SHA256(NOVU_SECRET_KEY, subscriberId)` as lowercase hex, computed on the server and passed as the `subscriberHash` prop. You turn it on with the "Security HMAC encryption" toggle in the In-App provider settings. If HMAC is on and the hash is missing, the Inbox won't load. Without HMAC, anyone who guesses a `subscriberId` can read that feed using the public `applicationIdentifier`. Source: https://docs.novu.co/platform/inbox/prepare-for-production
- **Real-time.** WebSocket: the docs set `socketUrl="wss://eu.socket.novu.co"` for EU, and `@novu/js` depends on `socket.io-client` and `partysocket`. Sources: https://docs.novu.co/platform/inbox/react/get-started, `npm view @novu/js dependencies`
- **Email / Postmark.** First-party Postmark integration: enter the Server API token and a verified From address in the Integrations page. Source: https://docs.novu.co/platform/integrations/email/postmark
- **Local dev / tests.** (1) Keyless Inbox: render `<Inbox />` with no props for a throwaway demo; the data expires after 24h and isn't tied to real subscribers. Source: https://docs.novu.co/platform/inbox/react/get-started. (2) Self-host: the core is MIT-licensed (an `enterprise/` folder is under a commercial license). Source: https://github.com/novuhq/novu. Self-hosting needs API, Worker, WS and Dashboard services plus MongoDB, Redis and S3, and "some features exclusive to Novu's cloud-managed solution will not be available". Source: https://docs.novu.co/community/self-hosting-novu/overview. Self-hosting is far heavier than Cadence's SQLite stack.

## MagicBell

- **Pricing.** Free "Builder": 1,000 deliveries/mo, unlimited users, "all integrations". Startup is $249/mo with 50,000 deliveries, then $0.0025/delivery. Source: https://www.magicbell.com/pricing
- **React component.** `@magicbell/react`, with subpath imports such as `@magicbell/react/inbox`, `/floating-inbox`, `/context-provider`. Wrap the app in `<Provider token={USER_JWT}>`. The docs don't state a React version or anything about SSR. Source: https://www.magicbell.com/docs/libraries/magicbell-react
  - npm (v1.14.0, last modified 2026-07-29): **no `peerDependencies` declared at all** and no repository field. Compared with the others, it is published less often and its React 19 compatibility isn't stated. Source: `npm view @magicbell/react`, package tarball
- **User identity.** The backend signs a **HS256** User JWT with the project Secret Key. Claims: `api_key` plus `user_external_id` and/or `user_email`. The examples use a 1-year expiry. Source: https://www.magicbell.com/docs/api/authentication/user
- **Real-time.** WebSocket: the package bundle connects to `wss://ws.magicbell.com` via `reconnecting-websocket`. The docs index also lists an EventSource integration. Sources: `@magicbell/react` 1.14.0 tarball, https://www.magicbell.com/docs
- **Email / Postmark.** The email channel lists Amazon SES, Mailgun, SendGrid, SMTP and Ping Email, with **no Postmark integration**. Source: https://www.magicbell.com/docs/channels/email. Postmark accepts SMTP (https://postmarkapp.com/developer/user-guide/send-email-with-smtp), so routing through Postmark via MagicBell's SMTP provider should be possible. This is an inference, not documented by MagicBell.
- **Local dev / tests.** The docs mention a CLI and a UI playground, but no test mode, sandbox, keyless mode or self-host option. Source: https://magicbell.com/docs/developer-tools

## Courier

- **Pricing.** Free "Developer": "Start free with 10,000 sends a month". Business is pay as you go at $0.005/send, and the first 10,000 sends are also charged. Enterprise is custom. The pricing page doesn't say whether Inbox is on the free plan. Source: https://www.courier.com/pricing
- **React component.** `@trycourier/courier-react` v9 (Inbox, Toasts, Preferences; `@trycourier/courier-react-17` for React 17; the old `@trycourier/react-inbox` is deprecated). Source: https://www.courier.com/docs/platform/inbox/inbox-overview
  - npm (v9.3.5, modified 2026-11-09): peer deps `react`/`react-dom` `>=18.0.0`. The dist carries no `"use client"` directive. Source: `npm view @trycourier/courier-react`, package tarball
- **User identity.** The backend calls Courier's **Issue Token** endpoint with the workspace API key and gets back a JWT. Scopes must include `user_id:<id> inbox:read:messages inbox:write:events`. Set `expires_in`, because if you omit it the token never expires. The client calls `signIn({ userId, jwt })`. The SDKs don't refresh tokens, so you re-mint and call `signIn` again. Unlike the others, this costs one server-side API call per token mint, with no local signing. Source: https://www.courier.com/docs/platform/inbox/authentication
- **Real-time.** WebSocket: `@trycourier/courier-js` 3.7.1 opens `wss://realtime.courier.io` (EU: `wss://realtime.eu.courier.io`). The docs mention a "real-time socket". Sources: package tarball, https://www.courier.com/docs/platform/inbox/authentication
- **Email / Postmark.** First-party Postmark integration ("Courier sends through your Postmark account"): Server API token plus From address. It supports per-message overrides (for example `MessageStream`) and Postmark's own templates. Source: https://www.courier.com/docs/external-integrations/email/postmark
- **Local dev / tests.** A separate **Test environment** with Test API keys. Test sends can be **simulated**, meaning routing and rendering run but no provider is contacted. A built-in Courier Test Email Provider delivers only to workspace teammates (up to 100 emails). Billing counts sends from all environments. No self-host. Sources: https://www.courier.com/docs/platform/workspaces/environments-api-keys, https://www.courier.com/docs/workspaces/environments

## React Router 8 SSR notes (all vendors)

- All four inboxes are browser-side widgets holding a WebSocket. None renders meaningful markup on the server. In React Router framework mode, render the inbox client-only (mount after hydration, or use a lazy client component) to avoid hydration mismatches. Knock's ESM entry is marked `"use client"`; the others aren't, which doesn't matter in RR8.
- The per-user credential (Knock JWT, Novu HMAC, MagicBell JWT, Courier JWT) fits naturally in a route `loader` that runs on the server, reading the user from Cadence's session. The secret stays in a `*.server.ts` module.
- Only Novu documents a React Router hook (`routerPush` with `navigate`). Knock declares an optional `@tanstack/react-router` peer, but none of the four mentions React Router 8 specifically.

## Trade-offs (non-binding)

- **Free headroom:** Knock, Novu and Courier all give about 10k/mo. MagicBell gives 1k. Novu is the only one with a cheap first paid tier ($30), against roughly $250 for Knock and MagicBell. Courier is metered.
- **Identity simplicity:** Novu's HMAC is the simplest to compute. Knock and MagicBell are local JWT signing (Knock uses asymmetric RS256). Courier needs a network call to mint each token, but adds scopes and server-controlled expiry.
- **Postmark reuse:** Knock, Novu and Courier have first-party Postmark integrations. MagicBell would need SMTP.
- **Offline / test story:** Novu is the only one you can run locally (keyless demo or self-host), though self-hosting is heavy. Courier has the clearest hosted test mode (simulated sends). Knock relies on a separate dev environment. MagicBell documents nothing here. For CI, all four point toward a thin server wrapper with a fake, in the style of `mailer.server.ts`.
- **Package health:** Knock, Novu and Courier publish often and declare React 19. MagicBell's React package declares no peers and was last published in July 2026.
