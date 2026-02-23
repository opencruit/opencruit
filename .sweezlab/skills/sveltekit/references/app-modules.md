# $app Modules — Full Reference

## $app/navigation

```typescript
import {
  goto, invalidate, invalidateAll,
  preloadData, preloadCode,
  beforeNavigate, afterNavigate, onNavigate,
  pushState, replaceState,
  disableScrollHandling
} from '$app/navigation';
```

### goto(url, opts?)

```typescript
await goto('/dashboard', {
  replaceState: false,  // replace vs push history
  noScroll: false,      // don't scroll to top
  keepFocus: false,     // retain focused element
  invalidateAll: false, // rerun all loads
  invalidate: [],       // specific invalidation targets
  state: {}             // history state
});
```

### invalidate(resource)

```typescript
// By URL
invalidate('/api/posts');
// By custom dependency (defined in load via depends())
invalidate('app:posts');
// By predicate
invalidate((url) => url.pathname.startsWith('/api'));
```

### invalidateAll()

Reruns ALL load functions and queries regardless of dependencies.

### preloadData(href)

Loads route code + executes load functions. Returns typed result:

```typescript
const result = await preloadData('/blog/post-1');
if (result.type === 'loaded') {
  console.log(result.status, result.data);
} else if (result.type === 'redirect') {
  console.log(result.location);
}
```

### preloadCode(pathname)

Imports route modules without executing loads. For prefetching.

### beforeNavigate(callback)

```typescript
beforeNavigate(({ from, to, type, cancel, willUnload, delta }) => {
  if (hasUnsavedChanges && !confirm('Discard changes?')) {
    cancel();
  }
});
// type: 'link' | 'popstate' | 'goto'
```

### afterNavigate(callback)

```typescript
afterNavigate(({ from, to, type }) => {
  // Runs after mount and each navigation
  analytics.track(to?.url.pathname);
});
```

### onNavigate(callback)

```typescript
onNavigate(({ from, to, type }) => {
  // Before DOM update. Return promise to delay.
  // Supports View Transitions:
  return new Promise((resolve) => {
    document.startViewTransition(resolve);
  });
});
```

### pushState / replaceState (Shallow Routing)

```typescript
pushState('', { showModal: true });   // new history entry, same URL
pushState('/photos/1', { data });     // new entry, new URL
replaceState('', { showModal: false }); // replace current entry
```

## $app/state

```typescript
import { page, navigating, updated } from '$app/state';
```

### page (reactive)

```typescript
page.url          // URL instance
page.params       // route params
page.route.id     // e.g. '/blog/[slug]'
page.data         // merged load data
page.form         // form action result
page.state        // shallow routing state
page.status       // HTTP status
page.error        // error object
```

**Important**: Uses Svelte 5 fine-grained reactivity. Use `$derived()`:

```svelte
<script>
  import { page } from '$app/state';
  let title = $derived(page.data.title);
</script>
```

### navigating

```typescript
navigating.from   // { url, params, route }
navigating.to     // { url, params, route }
navigating.type   // 'link' | 'popstate' | 'goto'
navigating.delta   // popstate only
navigating.willUnload // leaving site?
navigating.complete // promise
// null when idle
```

### updated

```typescript
updated.current   // boolean — new version deployed?
updated.check()   // async — force poll
```

Auto-polls if `config.kit.version.pollInterval` is non-zero.

## $app/environment

```typescript
import { browser, building, dev, version } from '$app/environment';
```

| Export | Type | Description |
|--------|------|-------------|
| `browser` | boolean | true in browser |
| `building` | boolean | true during `vite build` / prerender |
| `dev` | boolean | true in dev server |
| `version` | string | `config.kit.version.name` |

## $app/server

```typescript
import { read, getRequestEvent } from '$app/server';
// Remote functions also from here:
import { query, form, command, prerender } from '$app/server';
```

### read(asset)

Read imported static asset on server:

```typescript
import { read } from '$app/server';
import logo from '$lib/assets/logo.png';

const response = read(logo);
const blob = await response.blob();
```

### getRequestEvent()

Access current RequestEvent anywhere in server code without passing event:

```typescript
import { getRequestEvent } from '$app/server';

export function getCurrentUser() {
  const event = getRequestEvent();
  return event.locals.user;
}
```

## $app/paths

```typescript
import { asset, resolve, match } from '$app/paths';
```

- `asset(file)` — resolve static directory URL
- `resolve(pathname)` — prefix base path
- `resolve(routeId, params)` — build route URL from ID + params
- `match(url)` — match path against defined routes (since 2.52.0)

## $app/forms

```typescript
import { applyAction, deserialize, enhance } from '$app/forms';
```

- `enhance` — action for `use:enhance` directive
- `deserialize(text)` — parse form action response (NOT `JSON.parse`)
- `applyAction(result)` — apply action result to page state
