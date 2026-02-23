# Form Actions — Full Reference

## Default Action

```typescript
// +page.server.ts
import type { Actions } from './$types';

export const actions = {
  default: async ({ request, cookies, locals }) => {
    const data = await request.formData();
    const email = data.get('email') as string;
    // process...
  }
} satisfies Actions;
```

```svelte
<form method="POST">
  <input name="email" type="email">
  <button>Submit</button>
</form>
```

Pages with default action cannot have named actions.

## Named Actions

```typescript
export const actions = {
  login: async ({ request, cookies }) => {
    const data = await request.formData();
    // ...
  },
  register: async ({ request }) => {
    // ...
  }
} satisfies Actions;
```

```svelte
<form method="POST" action="?/login">
  <input name="email" type="email">
  <button>Login</button>
  <button formaction="?/register">Register</button>
</form>
```

Cross-page: `action="/other-page?/action"`

## Validation with fail()

```typescript
import { fail } from '@sveltejs/kit';

export const actions = {
  login: async ({ request }) => {
    const data = await request.formData();
    const email = data.get('email') as string;
    const password = data.get('password') as string;

    if (!email) {
      return fail(400, { email, missing: true });
    }

    const user = await db.getUser(email);
    if (!user) {
      return fail(400, { email, incorrect: true });
    }

    if (user.password !== hash(password)) {
      return fail(400, { email, incorrectPassword: true });
    }

    // Success — set cookie, redirect
    cookies.set('session', user.token, { path: '/' });
    redirect(303, '/dashboard');
  }
} satisfies Actions;
```

Access in component via `form` prop:

```svelte
<script>
  import { page } from '$app/state';
  // page.form contains the action result
</script>

{#if page.form?.missing}
  <p class="error">Email is required</p>
{/if}

{#if page.form?.incorrect}
  <p class="error">No account with that email</p>
{/if}

<input name="email" value={page.form?.email ?? ''}>
```

## Progressive Enhancement (use:enhance)

```svelte
<script>
  import { enhance } from '$app/forms';
</script>

<form method="POST" action="?/login" use:enhance>
  <!-- Works without JS, enhanced with JS -->
</form>
```

Without `use:enhance`: full-page POST, standard browser form submission.
With `use:enhance`: AJAX submission, no full reload.

## Custom enhance Callback

```svelte
<form method="POST" use:enhance={({ formElement, formData, action, submitter, cancel }) => {
  // Before submit
  // cancel() to prevent submission

  return async ({ result, update }) => {
    // After submit
    if (result.type === 'success') {
      await update(); // default behavior: update form prop + invalidate
    }
    if (result.type === 'failure') {
      // result.data contains fail() return
    }
    if (result.type === 'redirect') {
      // result.location contains target
    }
    if (result.type === 'error') {
      // result.error contains thrown error
    }
  };
}}>
```

Default `update()` behavior:
- success: reset form, invalidate all, update `page.form`
- failure: does NOT invalidate, updates `page.form`
- redirect: calls `goto()`
- error: renders nearest `+error.svelte`

Pass `{ reset: false }` to `update()` to keep form values.

## Manual Fetch (without use:enhance)

```typescript
import { deserialize, applyAction } from '$app/forms';

async function handleSubmit(event: SubmitEvent) {
  event.preventDefault();
  const data = new FormData(event.currentTarget as HTMLFormElement);

  const response = await fetch((event.currentTarget as HTMLFormElement).action, {
    method: 'POST',
    body: data
  });

  // MUST use deserialize, not JSON.parse (supports Date, BigInt)
  const result = deserialize(await response.text());

  if (result.type === 'success') {
    await invalidateAll();
  }

  applyAction(result);
}
```

## Loading Data After Action

Actions run before load functions. After action completes:
1. `use:enhance` calls `invalidateAll()` (for success)
2. Load functions rerun
3. Page updates with fresh data

Without `use:enhance`: full page reload naturally refetches everything.
