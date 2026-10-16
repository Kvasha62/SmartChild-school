# SmartChild lead API (local-first scaffold)

This is a separate Node API so the Astro site can remain static and be hosted independently.
It is not production-ready until a real PDF exists, SMTP is configured privately, and the API is deployed behind HTTPS.

## Local setup

1. From this directory, run `npm install` and `npm test`.
2. Copy `.env.example` to `.env` inside `api/` and fill it locally. `api/.env` is ignored by Git. Never commit or share the real values.
3. Place the approved PDF at `public/smartchild-checklist-oge-ege-informatics.pdf` in the repository root. `CHECKLIST_PATH` may be absolute or relative to the `api/` directory; the example `../public/smartchild-checklist-oge-ege-informatics.pdf` works regardless of the API process's current working directory.
4. Start the API with `npm start`; it listens on `127.0.0.1:8787` by default.
5. In the repository root, create/update ignored `.env.local` with `PUBLIC_LEAD_API_URL=http://127.0.0.1:8787/api/lead`, then restart `npm run dev`.
6. The API accepts only origins in `ALLOWED_ORIGINS`, limits request size and in-memory request frequency, and returns generic delivery errors.

For Gmail, use an App Password generated in the Google account after enabling 2-Step Verification. Do not use your normal Gmail password. Never share the App Password in chat, screenshots, or Git.

The in-memory rate limiter is best-effort and resets on restart; before public deployment, put a platform/WAF limit in front of the API. The API ignores `X-Forwarded-For` unless `TRUST_PROXY=true`; enable that flag only when the API cannot be reached directly and the immediate reverse proxy is trusted to set the header. Use HTTPS in production, keep the API host and site origin aligned, and test both email deliveries. A successful API response cannot guarantee inbox placement.
