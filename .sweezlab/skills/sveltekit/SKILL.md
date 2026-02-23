---
name: sveltekit
description: |
  SvelteKit framework guide — routing, data loading, remote functions, form actions, hooks, SSR, adapters.
  Use when:
  - Creating/editing +page.server.ts, +page.ts, +layout.server.ts, +server.ts files
  - Working with load functions, form actions, hooks
  - Using remote functions (query, form, command, prerender)
  - Configuring SSR, prerendering, adapters
  - Using $app/*, $env/* modules
  - Routing: params, groups, matchers, shallow routing
  - State management, snapshots, service workers
---

# SvelteKit

## Data Loading — Decision Tree

```
Need data on page load?
  → +page.server.ts load()          (server-only, DB/secrets)
  → +page.ts load()                 (universal, runs on server+client)

Need on-demand data from component?
  → query() in .remote.ts           (experimental, cached, type-safe)

Need to mutate data?
  → form() in .remote.ts            (progressive enhancement, validation)
  → command() in .remote.ts         (imperative, no form element needed)
  → Form actions in +page.server.ts (stable API, use:enhance)

Need static data at build time?
  → prerender() in .remote.ts       (build-time evaluation)
```

## Load Functions

**Server load** (`+page.server.ts`) — DB, secrets, cookies:

```typescript
import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ params, cookies, locals, fetch, depends, url }) => {
  depends('app:posts'); // custom invalidation key
  const post = await db.getPost(params.slug);
  if (!post) error(404, 'Not found');
  return { post };
};
```

**Universal load** (`+page.ts`) — runs server+client, can return non-serializable data:

```typescript
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ data, fetch }) => {
  // `data` contains server load result
  return { ...data, component: await import('./special.svelte') };
};
```

**Streaming** — return nested promises for skeleton UI:

```typescript
export const load: PageServerLoad = async () => {
  return {
    fast: await getFast(),
    slow: getSlow() // no await — streams to client
  };
};
```

**Rerun triggers**: param change, url change, `invalidate()`, `invalidateAll()`, parent rerun.

## Remote Functions (Experimental)

Enable in `svelte.config.js`:

```javascript
export default {
  kit: { experimental: { remoteFunctions: true } },
  compilerOptions: { experimental: { async: true } }
};
```

### query — Read data on-demand

```typescript
// src/lib/server/posts.remote.ts
import { query } from '$app/server';
import * as db from '$lib/server/database';

export const getPosts = query(async () => {
  return await db.sql`SELECT title, slug FROM post ORDER BY published_at DESC`;
});

// With validation (Standard Schema — Zod, Valibot)
export const getPost = query(v.string(), async (slug) => {
  const [post] = await db.sql`SELECT * FROM post WHERE slug = ${slug}`;
  if (!post) error(404, 'Not found');
  return post;
});
```

```svelte
<!-- Component usage with await -->
{#each await getPosts() as { title, slug }}
  <a href="/blog/{slug}">{title}</a>
{/each}
```

Queries are **cached** per page lifecycle. Call `.refresh()` to re-fetch.

**Batch** (solves N+1):

```typescript
export const getWeather = query.batch(v.string(), async (cityIds) => {
  const weather = await db.sql`SELECT * FROM weather WHERE city_id = ANY(${cityIds})`;
  const lookup = new Map(weather.map(w => [w.city_id, w]));
  return (cityId) => lookup.get(cityId);
});
```

### form — Write with progressive enhancement

```typescript
export const createPost = form(
  v.object({ title: v.pipe(v.string(), v.nonEmpty()), content: v.string() }),
  async ({ title, content }) => {
    await db.sql`INSERT INTO post (title, content) VALUES (${title}, ${content})`;
    redirect(303, `/blog/${slug}`);
  }
);
```

```svelte
<form {...createPost}>
  <input {...createPost.fields.title.as('text')} />
  {#each createPost.fields.title.issues() as issue}
    <p class="error">{issue.message}</p>
  {/each}
  <button>Publish</button>
</form>
```

Enhancement + single-flight mutations:

```svelte
<form {...createPost.enhance(async ({ submit }) => {
  await submit().updates(getPosts());
})}>
```

### command — Imperative mutations

```typescript
export const addLike = command(v.string(), async (id) => {
  await db.sql`UPDATE item SET likes = likes + 1 WHERE id = ${id}`;
});
```

```svelte
<button onclick={async () => {
  await addLike(item.id).updates(getLikes(item.id));
}}>Like</button>
```

### prerender — Build-time data

```typescript
export const getPosts = prerender(async () => {
  return await db.sql`SELECT * FROM post`;
});
```

## Form Actions (Stable API)

```typescript
// +page.server.ts
import { fail } from '@sveltejs/kit';

export const actions = {
  login: async ({ request, cookies }) => {
    const data = await request.formData();
    const email = data.get('email');
    if (!email) return fail(400, { email, missing: true });
    cookies.set('session', token, { path: '/' });
  },
  register: async (event) => { /* ... */ }
};
```

```svelte
<script>
  import { enhance } from '$app/forms';
</script>

<form method="POST" action="?/login" use:enhance>
  <input name="email" type="email">
  <button>Login</button>
</form>
```

## Routing

See [references/routing.md](references/routing.md) for full details.

| Pattern | Example | Matches |
|---------|---------|---------|
| `[param]` | `/blog/[slug]` | `/blog/hello` |
| `[[optional]]` | `/blog/[[lang]]` | `/blog`, `/blog/en` |
| `[...rest]` | `/files/[...path]` | `/files/a/b/c` |
| `[param=matcher]` | `/[lang=locale]` | Only if matcher returns true |
| `(group)` | `(app)/dashboard` | Groups without URL segment |

**Route files**: `+page.svelte`, `+page.ts`, `+page.server.ts`, `+layout.svelte`, `+layout.ts`, `+layout.server.ts`, `+server.ts`, `+error.svelte`

## Hooks

See [references/hooks.md](references/hooks.md) for full details.

```typescript
// src/hooks.server.ts
export async function handle({ event, resolve }) {
  event.locals.user = await getUser(event.cookies.get('session'));
  return resolve(event);
}

export function handleError({ error, event }) {
  return { message: 'Something went wrong' };
}
```

## $env Modules

| Module | Scope | Timing | Use for |
|--------|-------|--------|---------|
| `$env/static/private` | Server | Build | API keys, DB URLs (tree-shakeable) |
| `$env/dynamic/private` | Server | Runtime | Platform-specific vars |
| `$env/static/public` | Client+Server | Build | Public config |
| `$env/dynamic/public` | Client+Server | Runtime | Runtime public config |

```typescript
import { DATABASE_URL } from '$env/static/private';
import { env } from '$env/dynamic/private';     // env.DATABASE_URL
import { PUBLIC_API_URL } from '$env/static/public';
```

## $app Modules

See [references/app-modules.md](references/app-modules.md) for full details.

**Key exports:**

```typescript
// Navigation
import { goto, invalidate, invalidateAll, preloadData, pushState, replaceState } from '$app/navigation';

// State (reactive — use with $derived)
import { page, navigating, updated } from '$app/state';

// Environment
import { browser, building, dev } from '$app/environment';

// Server (remote functions + asset reading)
import { read, getRequestEvent, query, form, command, prerender } from '$app/server';
```

## Page Options

```typescript
// In +page.ts or +layout.ts
export const ssr = true;        // server-side render (default)
export const csr = true;        // client-side render (default)
export const prerender = false;  // static HTML at build time
export const trailingSlash = 'never'; // 'always' | 'ignore'
```

## Server-Only Modules

Two conventions — both prevent client import:

1. `filename.server.ts` suffix
2. `$lib/server/` directory

Build fails if client code imports server-only module (entire import chain analyzed).

## Shallow Routing

```svelte
<script>
  import { pushState } from '$app/navigation';
  import { page } from '$app/state';
</script>

<button onclick={() => pushState('', { showModal: true })}>Open</button>

{#if page.state.showModal}
  <Modal close={() => history.back()} />
{/if}
```

## Snapshots

```svelte
<script>
  let comment = $state('');
  export const snapshot = {
    capture: () => comment,
    restore: (v) => comment = v
  };
</script>
```

## Async Await in Components (Experimental)

Requires `compilerOptions.experimental.async: true`. Use `await` in markup:

```svelte
<svelte:boundary>
  <p>{await fetchData()}</p>
  {#snippet pending()}
    <p>Loading...</p>
  {/snippet}
</svelte:boundary>
```

## Adapter Node

```javascript
import adapter from '@sveltejs/adapter-node';
export default { kit: { adapter: adapter({ out: 'build' }) } };
```

Env vars: `PORT` (3000), `HOST` (0.0.0.0), `ORIGIN`, `BODY_SIZE_LIMIT` (512kb).

Custom server: import `handler` from `./build/handler.js`, mount on Express/Polka.

Graceful shutdown: listen for `sveltekit:shutdown` event on `process`.

## State Management Rules

1. **Never store user state in shared server variables** — servers are shared
2. **Load functions must be pure** — return data, don't write to globals
3. **Use Context API** for server-safe shared state
4. **URL searchParams** for ephemeral filter/sort state (survives reload, affects SSR)

## References

- [references/routing.md](references/routing.md) — Advanced routing, matchers, groups, layout reset
- [references/hooks.md](references/hooks.md) — All hooks: handle, handleFetch, handleError, reroute, transport
- [references/app-modules.md](references/app-modules.md) — $app/navigation, $app/state, $app/environment, $app/server
- [references/remote-functions.md](references/remote-functions.md) — Full remote functions API with all patterns
- [references/form-actions.md](references/form-actions.md) — Form actions, use:enhance, applyAction
