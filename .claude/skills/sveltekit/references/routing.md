# Routing — Full Reference

## File Conventions

| File | Purpose |
|------|---------|
| `+page.svelte` | Page component |
| `+page.ts` | Universal load (server+client) |
| `+page.server.ts` | Server load + form actions |
| `+layout.svelte` | Layout wrapper (`{@render children()}`) |
| `+layout.ts` | Universal layout load |
| `+layout.server.ts` | Server layout load |
| `+server.ts` | API route (GET, POST, PUT, DELETE, etc.) |
| `+error.svelte` | Error boundary page |

## Route Parameters

```
src/routes/blog/[slug]/+page.svelte     → /blog/hello-world
src/routes/blog/[[lang]]/+page.svelte   → /blog or /blog/en (optional)
src/routes/files/[...path]/+page.svelte → /files/a/b/c (rest)
```

For `/[org]/[repo]/tree/[branch]/[...file]` matching `/sveltejs/kit/tree/main/docs/routing.md`:
```javascript
{ org: 'sveltejs', repo: 'kit', branch: 'main', file: 'docs/routing.md' }
```

## Custom Matchers

```typescript
// src/params/integer.ts
import type { ParamMatcher } from '@sveltejs/kit';

export const match: ParamMatcher = (param) => {
  return /^\d+$/.test(param);
};
```

Use: `src/routes/items/[id=integer]/+page.svelte`

## Route Groups

Directories in `()` don't affect URL:

```
src/routes/
  (app)/
    dashboard/+page.svelte    → /dashboard
    settings/+page.svelte     → /settings
    +layout.svelte             → shared app layout
  (marketing)/
    about/+page.svelte        → /about
    +layout.svelte             → shared marketing layout
  +layout.svelte               → root layout
```

## Layout Reset (@)

Skip parent layouts:

- `+page@.svelte` — root layout only
- `+page@(app).svelte` — (app) group layout
- `+layout@.svelte` — reset layout chain

## API Routes (+server.ts)

```typescript
import type { RequestHandler } from './$types';
import { json, text, error } from '@sveltejs/kit';

export const GET: RequestHandler = async ({ url, params, cookies, request }) => {
  return json({ items: [...] });
};

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json();
  return new Response(null, { status: 201 });
};
```

## Route Priority

1. Exact matches (highest)
2. `[name=type]` (with matcher)
3. `[name]` (dynamic)
4. `[[optional]]` and `[...rest]` (lowest)
5. Alphabetical tiebreaker

## Encoding Special Characters

For route `/smileys/:-)`:
```
src/routes/smileys/[x+3a]-[x+29]/+page.svelte
```

`[x+nn]` for hex escapes.

## Link Options

```html
<a href="/about" data-sveltekit-preload-data="hover">About</a>
```

| Attribute | Values |
|-----------|--------|
| `data-sveltekit-preload-data` | `"hover"` (default), `"tap"` |
| `data-sveltekit-preload-code` | `"eager"`, `"viewport"`, `"hover"`, `"tap"` |
| `data-sveltekit-reload` | Full-page navigation |
| `data-sveltekit-replacestate` | Replace history entry |
| `data-sveltekit-keepfocus` | Retain focus after nav |
| `data-sveltekit-noscroll` | Don't scroll to top |

## Auto-Generated Types

```typescript
import type { PageProps, PageLoad, PageServerLoad, LayoutLoad } from './$types';
```

SvelteKit generates these per-route. Always use `./$types` imports.
