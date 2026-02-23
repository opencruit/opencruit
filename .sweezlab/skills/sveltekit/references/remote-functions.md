# Remote Functions — Full Reference

Remote functions are exported from `.remote.ts` files. Type-safe, cached, progressive enhancement.

## Setup

```javascript
// svelte.config.js
export default {
  kit: { experimental: { remoteFunctions: true } },
  compilerOptions: { experimental: { async: true } }
};
```

## query

Read dynamic data. Cached per page lifecycle.

```typescript
import { query } from '$app/server';

// No args
export const getPosts = query(async () => {
  return await db.sql`SELECT * FROM post ORDER BY published_at DESC`;
});

// With Standard Schema validation (Zod, Valibot)
export const getPost = query(v.string(), async (slug) => {
  const [post] = await db.sql`SELECT * FROM post WHERE slug = ${slug}`;
  if (!post) error(404, 'Not found');
  return post;
});
```

### Caching behavior

```svelte
<!-- Same reference, same result (cached) -->
{#each await getPosts() as post}
  ...
{/each}
```

`getPosts() === getPosts()` returns true. Call `.refresh()` to invalidate cache.

### query.batch — Solves N+1

```typescript
export const getWeather = query.batch(v.string(), async (cityIds) => {
  const weather = await db.sql`SELECT * FROM weather WHERE city_id = ANY(${cityIds})`;
  const lookup = new Map(weather.map(w => [w.city_id, w]));
  return (cityId) => lookup.get(cityId);
});
```

Multiple `getWeather(id)` calls in one render batched into single DB query.

## form

Write data with progressive enhancement and validation.

```typescript
import { form } from '$app/server';
import * as v from 'valibot';

export const createPost = form(
  v.object({
    title: v.pipe(v.string(), v.nonEmpty()),
    content: v.pipe(v.string(), v.nonEmpty())
  }),
  async ({ title, content }) => {
    const user = await auth.getUser();
    if (!user) error(401, 'Unauthorized');
    const slug = title.toLowerCase().replace(/ /g, '-');
    await db.sql`INSERT INTO post (slug, title, content) VALUES (${slug}, ${title}, ${content})`;
    redirect(303, `/blog/${slug}`);
  }
);
```

### Usage in component

```svelte
<form {...createPost}>
  <input {...createPost.fields.title.as('text')} />
  <textarea {...createPost.fields.content.as('text')}></textarea>

  {#each createPost.fields.title.issues() as issue}
    <p class="error">{issue.message}</p>
  {/each}

  <button>Publish</button>
</form>
```

### Field rendering methods

`.as('text')`, `.as('number')`, `.as('password')`, `.as('file')`, `.as('checkbox')`, `.as('radio', value)`, `.as('select')`, `.as('select multiple')`, `.as('submit', value)`

### Enhancement + single-flight mutations

```svelte
<form {...createPost.enhance(async ({ form, data, submit }) => {
  try {
    await submit();
    form.reset();
    showToast('Published!');
  } catch (error) {
    showToast('Error!');
  }
})}>
```

### Refreshing queries after mutation

```typescript
// Server-side (inside form handler)
await getPosts().refresh();
await getPost(slug).set(result); // set directly

// Client-side (in enhance callback)
await submit().updates(getPosts());

// With optimistic update
await submit().updates(
  getPosts().withOverride((posts) => [newPost, ...posts])
);
```

### Multiple form instances

```svelte
{#each await getTodos() as todo}
  {@const modify = modifyTodo.for(todo.id)}
  <form {...modify}>
    <input {...modify.fields.text.as('text')} />
    <button disabled={!!modify.pending}>Save</button>
  </form>
{/each}
```

### Sensitive fields

Prefix with underscore (`_password`) — not repopulated on validation failure.

## command

Imperative mutations without form element.

```typescript
import { command } from '$app/server';

export const addLike = command(v.string(), async (id) => {
  await db.sql`UPDATE item SET likes = likes + 1 WHERE id = ${id}`;
});
```

```svelte
<button onclick={async () => {
  try {
    await addLike(item.id);
  } catch (error) {
    showToast('Error');
  }
}}>Like</button>
```

### Updating queries from commands

```svelte
await addLike(item.id).updates(getLikes(item.id));

// With optimistic update
await addLike(item.id).updates(
  getLikes(item.id).withOverride((n) => n + 1)
);
```

Commands **cannot** be called during render.

## prerender

Evaluate at build time.

```typescript
export const getPosts = prerender(async () => {
  return await db.sql`SELECT * FROM post`;
});

// With inputs for specific arguments
export const getPost = prerender(
  v.string(),
  async (slug) => { /* ... */ },
  { inputs: () => ['first-post', 'second-post'] }
);

// Dynamic — fallback to runtime for unknown args
export const getPost = prerender(
  v.string(),
  async (slug) => { /* ... */ },
  { dynamic: true, inputs: () => ['first-post'] }
);
```

## Validation error handling

```typescript
// hooks.server.ts
export const handleValidationError = ({ event, issues }) => {
  return { message: 'Nice try, hacker!' };
};
```

Opt out of validation:

```typescript
export const getStuff = query('unchecked', async (input) => { /* ... */ });
```

## Serialization

Uses Devalue library. Supports: Date, Map, Set, RegExp, BigInt.
Custom types via `transport` hook in `hooks.ts`.
