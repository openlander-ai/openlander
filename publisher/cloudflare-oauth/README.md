# OpenLander Cloudflare OAuth publisher

This static site owns the fixed callback for the public OpenLander Cloudflare
OAuth client. Deploy the directory at `https://openlander.dongbin.cloud`.

The callback is deliberately static. It passes the authorization code and state
to the exact browser window that initiated the flow; each self-hosted OpenLander
instance performs its own PKCE token exchange and token storage.

`cloudflare-oauth-callback.html` and `cloudflare-oauth-callback.js` must stay
byte-for-byte aligned with the copies under `web/public/`. Release tests enforce
that invariant.
