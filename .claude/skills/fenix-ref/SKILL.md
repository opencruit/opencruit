# Fenix Reference — Testing & Svelte Patterns

Reference skill based on `/opt/workspaces/fpm-release/fpm/apps/fenix/` — a production SvelteKit 5 + Svelte 5 app.
Use this as a source of proven patterns when building tests, components, and infrastructure for OpenCruit.

## When to Use

- Setting up Vitest for SvelteKit (jsdom, browser conditions, setup files)
- Writing component or store tests with `mount`/`tick`/`unmount`
- Setting up Playwright E2E (mock mode, real backend mode, dual CSR/SSR)
- Writing E2E mocks with `page.route()` interception
- Testing SvelteKit hooks.server.ts
- Svelte 5 store testing via host components

## Source Project

```
/opt/workspaces/fpm-release/fpm/
├── apps/fenix/                    # SvelteKit 5 app
│   ├── vitest.config.ts           # Vitest config (jsdom + browser conditions)
│   ├── src/vitest.setup.ts        # DOM polyfills (matchMedia, scrollIntoView)
│   ├── playwright.config.ts       # Playwright E2E (CSR/SSR dual mode)
│   ├── src/hooks.server.test.ts   # Server hooks unit test example
│   ├── src/lib/domains/cashier/
│   │   ├── DepositStore.test.ts   # Store test via host component
│   │   └── DepositStoreHost.svelte
│   └── e2e/
│       ├── domains/               # E2E tests by feature domain
│       │   ├── auth/              # Auth flows + mocks
│       │   ├── exchange/          # Exchange mocks (route interception)
│       │   ├── profile-deposit/   # Real + mocked deposit tests
│       │   └── lootboxes/         # Complex stateful mocks
│       ├── helpers/               # Reusable E2E actions
│       │   ├── e2e-user.ts        # User pool for parallel workers
│       │   ├── profile.ts         # Profile section navigation
│       │   └── cashier-methods.ts # Cashier method selection
│       └── setup/                 # Global setup/teardown
└── packages/
    ├── shared/vitest.config.ts    # Node env for non-Svelte packages
    └── intl/vitest.config.ts      # Svelte packages with browser conditions
```

## Key Patterns

### 1. Vitest Config for SvelteKit (jsdom + browser conditions)

Vitest runs through Vite's SSR pipeline, which resolves `svelte` to its server entry.
Force browser conditions so `mount()` and DOM APIs work in tests.

```typescript
// vitest.config.ts
const CONDITIONS = ['browser', 'module', 'node', 'development|production'];

export default defineConfig({
  plugins: [sveltekit()],
  resolve: { conditions: CONDITIONS },
  ssr: { resolve: { conditions: CONDITIONS } },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{ts,js}'],
    exclude: ['e2e/**'],
    setupFiles: ['./src/vitest.setup.ts'],
  },
});
```

**Setup file** — polyfill DOM APIs missing in jsdom:

```typescript
// vitest.setup.ts
import { vi } from 'vitest';

if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  }) as unknown as MediaQueryList) as typeof window.matchMedia;
}

if (typeof window !== 'undefined' && typeof HTMLElement !== 'undefined') {
  if (typeof HTMLElement.prototype.scrollIntoView !== 'function') {
    HTMLElement.prototype.scrollIntoView = () => undefined;
  }
}
```

**Non-Svelte packages** — simple node environment:

```typescript
// packages/shared/vitest.config.ts
export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
```

### 2. Store Testing via Host Component

Svelte 5 stores that use runes ($state, $derived) must run inside a component.
Pattern: create a thin host component that instantiates the store and exposes it via callback.

```svelte
<!-- DepositStoreHost.svelte -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { DepositStore } from './DepositStore.svelte';

  let { cashier, bonuses, user, captcha, intl, isAuthenticated, onReady } = $props();

  const store = new DepositStore({ cashier, bonuses, user, captcha, intl, isAuthenticated });
  onMount(() => onReady(store));
</script>
```

```typescript
// DepositStore.test.ts
import { mount, tick, unmount } from 'svelte';

async function flush(): Promise<void> {
  await tick();
  await tick();  // double tick ensures derived values settle
}

async function mountStoreHost(deps?: Partial<MountStoreHostDeps>) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  let store: DepositStore | undefined;

  const app = mount(DepositStoreHost, {
    target,
    props: {
      cashier: deps?.cashier ?? ({} as CashierRepository),
      bonuses: deps?.bonuses ?? ({} as BonusesRepository),
      // ... other deps with defaults
      onReady: (next: DepositStore) => { store = next; },
    },
  });

  await flush();
  if (!store) throw new Error('Host did not call onReady');
  return { store, app };
}

// Usage in test:
it('validates empty promo code', async () => {
  const host = await mountStoreHost({ bonuses });
  host.store.setEnabled(true);
  const result = await host.store.applyPromoCode({ code: '   ' });
  expect(result.ok).toBe(false);
  await unmount(host.app);
});
```

### 3. SvelteKit hooks.server.ts Testing

Test server hooks by mocking Request, cookies, and resolve function:

```typescript
function createCookieJar(initial: Record<string, string> = {}) {
  const storage = { ...initial };
  return {
    get: (name: string) => storage[name],
    set: (name: string, value: string) => { storage[name] = value; },
    _dump: () => ({ ...storage }),
  };
}

test('sets locale from accept-language', async () => {
  const cookies = createCookieJar();
  const event = {
    cookies,
    locals: {},
    route: { id: null },
    request: new Request('http://localhost/', {
      headers: { 'accept-language': 'ru-RU,ru;q=0.9,en;q=0.8' },
    }),
    url: new URL('http://localhost/'),
  };
  const resolve = vi.fn().mockResolvedValue(new Response('ok'));
  await handle({ event: event as never, resolve });
  expect(event.locals.locale).toBe('ru');
});
```

### 4. Playwright E2E Config (Dual Mock/Real Backend)

```typescript
// playwright.config.ts
const CSR_PORT = 6111;
const SSR_PORT = 6112;
const USE_CASINO_BACKEND = process.env.E2E_USE_CASINO_BACKEND === '1';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: !USE_CASINO_BACKEND,
  workers: USE_CASINO_BACKEND ? 1 : undefined,
  globalSetup: './e2e/setup/casino-backend.setup.ts',
  globalTeardown: './e2e/setup/casino-backend.teardown.ts',
  use: { screenshot: 'only-on-failure', trace: 'on-first-retry' },
  webServer: [{
    command: `PORT=${CSR_PORT} pnpm dev -- --port ${CSR_PORT}`,
    port: CSR_PORT,
    reuseExistingServer: !process.env.CI,
  }],
  projects: [{
    name: 'csr-chromium',
    testIgnore: '**/*.ssr.*.spec.ts',
    use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${CSR_PORT}` },
  }],
});
```

Key env vars: `E2E_USE_CASINO_BACKEND`, `E2E_BROWSER_CHANNEL`, `E2E_ENABLE_SSR`, `E2E_RUN_ID`.

### 5. E2E Mock Pattern (Route Interception)

Type-safe mocks with `page.route()`, assertions on request method/headers/params:

```typescript
// exchange.mock.ts
export async function mockExchangeRates(page: Page, payload?: { rates?: ExchangeRateMockItem[] }) {
  const rates = payload?.rates ?? [
    { id: null, base: 'USD', quote: 'EUR', rate: 0.9 },
  ];

  await page.route('**/api/rates**', async (route) => {
    expect(route.request().method()).toBe('GET');
    expect(route.request().headers()['x-auth']).toBeTruthy();

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: rates }),
    });
  });
}
```

**Stateful mocks** — pass mutable state object to track changes across requests:

```typescript
export type LootboxesMockState = {
  seenById: Map<number, boolean>;
  selectedLootboxId: number | null;
};

export async function mockLootboxesAvailable(page: Page, payload: { state: LootboxesMockState; list: RawLootboxShort[] }) {
  await page.route('**/api/loot-boxes/available**', async (route) => {
    const data = payload.list.map((x) => ({
      ...x,
      is_seen: payload.state.seenById.get(x.id) === true ? 1 : x.is_seen,
    }));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });
  });
}
```

### 6. E2E User Pool for Parallel Workers

```typescript
// e2e/helpers/e2e-user.ts
export function getE2eAuthUser(testInfo: TestInfo) {
  const poolRaw = process.env.E2E_USER_POOL;
  if (poolRaw) {
    const users = JSON.parse(poolRaw);
    return users[testInfo.workerIndex % users.length];
  }
  return { email: process.env.E2E_AUTH_EMAIL ?? 'admin@gmail.com', password: '12345678' };
}
```

### 7. E2E Reusable Helpers

```typescript
// e2e/helpers/profile.ts — navigation helpers
export async function openProfileSection(page: Page, sectionId: string) {
  await openProfileMenu(page);
  // handle mobile vs desktop layout
  const sectionButton = page.getByTestId(`profile-section-${sectionId}`);
  await expect(sectionButton).toBeVisible({ timeout: 15_000 });
  await sectionButton.click();
}

// e2e/helpers/cashier-methods.ts — domain helpers
export async function selectFirstCashierMethod(page: Page, payload: { prefix: string }) {
  const methodTile = page.locator(`[data-testid^="${payload.prefix}-tile-method-"]`);
  if ((await methodTile.count()) > 0) {
    await methodTile.first().click();
    return;
  }
  // fallback: open group first, then select method
  const groupTile = page.locator(`[data-testid^="${payload.prefix}-tile-group-"]`);
  await groupTile.first().click();
  await methodTile.first().click();
}
```

### 8. DI Pattern for Testability

Stores and repositories accept deps via constructor — no global singletons:

```typescript
class DepositStore {
  constructor(deps: { cashier: CashierRepository; bonuses: BonusesRepository; user: UserRepository; ... }) {
    // ...
  }
}
```

Tests provide mocked deps: `deps?.cashier ?? ({} as unknown as CashierRepository)`.

## Reference Files (read when needed)

| What | Path |
|------|------|
| Vitest config (SvelteKit) | `/opt/workspaces/fpm-release/fpm/apps/fenix/vitest.config.ts` |
| Vitest setup | `/opt/workspaces/fpm-release/fpm/apps/fenix/src/vitest.setup.ts` |
| Playwright config | `/opt/workspaces/fpm-release/fpm/apps/fenix/playwright.config.ts` |
| Hooks test | `/opt/workspaces/fpm-release/fpm/apps/fenix/src/hooks.server.test.ts` |
| Store test + host | `/opt/workspaces/fpm-release/fpm/apps/fenix/src/lib/domains/cashier/DepositStore.test.ts` |
| E2E auth flows | `/opt/workspaces/fpm-release/fpm/apps/fenix/e2e/domains/auth/` |
| E2E mock example | `/opt/workspaces/fpm-release/fpm/apps/fenix/e2e/domains/exchange/exchange.mock.ts` |
| E2E real backend | `/opt/workspaces/fpm-release/fpm/apps/fenix/e2e/domains/profile-deposit/profile-deposit.real.spec.ts` |
| E2E helpers | `/opt/workspaces/fpm-release/fpm/apps/fenix/e2e/helpers/` |
| E2E setup/teardown | `/opt/workspaces/fpm-release/fpm/apps/fenix/e2e/setup/` |
| Stateful mock | `/opt/workspaces/fpm-release/fpm/apps/fenix/e2e/domains/lootboxes/lootboxes.mock.ts` |
| Svelte pkg vitest | `/opt/workspaces/fpm-release/fpm/packages/intl/vitest.config.ts` |
| Node pkg vitest | `/opt/workspaces/fpm-release/fpm/packages/shared/vitest.config.ts` |
