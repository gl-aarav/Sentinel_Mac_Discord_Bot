# Discord Interactions Endpoint + App Pages

This project gives you:

- **POST /interactions** — the Interactions Endpoint URL for your Discord application.
- **GET /linked-roles/verify** — a simple user-facing page to use as your Linked Roles Verification URL (placeholder flow).
- **GET /terms** — Terms of Service page.
- **GET /privacy** — Privacy Policy page.
- **GET /** — a small landing page with links.

## Quick Start

```bash
cp .env.example .env
# Fill PUBLIC_KEY from your Discord app page
npm install
npm start
```

Open http://localhost:3000/

Paste your production URLs into the Discord Developer Portal:

- Interactions Endpoint URL: `https://YOUR_HOST/interactions`
- Linked Roles Verification URL: `https://YOUR_HOST/linked-roles/verify`
- Terms of Service URL: `https://YOUR_HOST/terms`
- Privacy Policy URL: `https://YOUR_HOST/privacy`

## Notes

- The Interactions endpoint verifies requests using your app's `PUBLIC_KEY` and replies to `PING` as required by Discord.
- A sample `ping` slash command is handled. Register it in your server via your preferred method, or just test that the endpoint responds to `PING` by saving it in the portal.
- The linked roles page is a placeholder; add OAuth2 and metadata updates when you're ready.
