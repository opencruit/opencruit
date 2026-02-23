# Hooks — Full Reference

Three hook files:
- `src/hooks.server.ts` — server only
- `src/hooks.client.ts` — client only
- `src/hooks.ts` — universal (both)

## Server Hooks

### handle

Runs for every server request. Middleware pattern.

```typescript
import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
  // Before route handler
  event.locals.user = await getUser(event.cookies.get('session'));

  const response = await resolve(event, {
    // Transform HTML chunks during streaming
    transformPageChunk: ({ html }) => html.replace('%lang%', 'en'),
    // Allow specific headers in serialized responses
    filterSerializedResponseHeaders: (name) => name === 'content-type',
    // Control resource preloading
    preload: ({ type }) => type === 'js' || type === 'css'
  });

  // After route handler
  return response;
};
```

### handleFetch

Intercept/modify `event.fetch` calls on server.

```typescript
export async function handleFetch({ event, request, fetch }) {
  // Reroute external API to internal during SSR
  if (request.url.startsWith('https://api.example.com/')) {
    request = new Request(
      request.url.replace('https://api.example.com/', 'http://localhost:3000/'),
      request
    );
  }
  return fetch(request);
}
```

### handleError

Called for unexpected errors (not `error()` from @sveltejs/kit).

```typescript
export function handleError({ error, event, status, message }) {
  const errorId = crypto.randomUUID();
  console.error(error, event, errorId);
  return { message: 'Something went wrong', errorId };
}
```

### handleValidationError

Called when remote function arguments fail schema validation.

```typescript
export const handleValidationError = ({ event, issues }) => {
  return { message: 'Invalid input' };
};
```

### init

Runs once when server starts. Async supported.

```typescript
export async function init() {
  await db.connect();
}
```

## Universal Hooks (hooks.ts)

### reroute

Modify URL-to-route translation before handle. Can be async (since v2.18).

```typescript
import type { Reroute } from '@sveltejs/kit';

export const reroute: Reroute = ({ url }) => {
  if (url.pathname === '/de/ueber-uns') return '/de/about';
};
```

### transport

Define serializers for custom types across server/client boundary.

```typescript
export const transport = {
  MyClass: {
    encode: (value) => value instanceof MyClass ? value.toJSON() : false,
    decode: (data) => MyClass.fromJSON(data)
  }
};
```

## Combining Hooks

```typescript
import { sequence } from '@sveltejs/kit/hooks';
import { authHandle } from './auth';
import { i18nHandle } from './i18n';

export const handle = sequence(authHandle, i18nHandle);
```

## event.locals

Type in `src/app.d.ts`:

```typescript
declare global {
  namespace App {
    interface Locals {
      user: { id: string; name: string } | null;
    }
  }
}
```

Access in load functions, form actions, hooks, API routes via `event.locals`.
