# ForgeGUI Interactive Frontend

Static HTML, CSS, and JavaScript frontend for ForgeGUI. The site compiler renders
desktop and mobile variants and the browser client connects directly to the
ForgeGUI Supabase backend.

## Development

```sh
npm install
npm run dev
```

The development site binds to all network interfaces and runs at
`http://192.168.1.100:8080` by default so it can be tested from another device on
the same network. Override the address with `FORGE_DEV_HOST` when needed.

```sh
npm run check
npm run build
```

## Backend Configuration

Production Supabase browser configuration is embedded in `tools/site.mjs` and can
be overridden for staging or local development:

```sh
FORGE_SUPABASE_URL=https://project.supabase.co \
FORGE_SUPABASE_ANON_KEY=public-anon-key \
npm run dev
```

During `npm run dev`, the default browser API endpoint is
`http://192.168.1.100:54321`. Production builds continue to use the hosted
Supabase project unless the build environment overrides it.

The anon key is a public browser credential. Backend authorization must remain in
Row Level Security policies and Edge Function authentication checks.

Supabase Auth must allow these redirect URLs for every deployed frontend origin:

```text
/auth/callback.html
/auth/reset-password.html
```

Google sign-in uses PKCE. Password signup uses the backend's `captcha-issue`,
`captcha-verify`, and `signup-with-captcha` functions before creating a session.
