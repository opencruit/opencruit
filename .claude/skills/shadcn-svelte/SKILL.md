# shadcn-svelte

Install and manage shadcn-svelte UI components in the OpenCruit monorepo.

## When to Use

- User asks to add/install UI components (button, card, dialog, etc.)
- User mentions shadcn, shadcn-svelte, or UI components
- Need to set up shadcn-svelte in the project for the first time

## Context

- CLI: `shadcn-svelte@1.1.1`
- All commands run from `apps/web/` directory
- Components go to `apps/web/src/lib/components/ui/<name>/`
- Uses Svelte 5 runes, Tailwind CSS v4 (OKLCH colors, CSS-based config)
- Config file: `apps/web/components.json`

## First-Time Init

Run from `apps/web/`:

```bash
cd apps/web && pnpm dlx shadcn-svelte@latest init
```

Prompts:
- **Base color**: pick one (neutral, slate, gray, zinc, stone, etc.)
- **CSS file path**: `src/app.css`
- **Import aliases**: keep defaults (`$lib`, `$lib/utils`, `$lib/components/ui`)

Creates:
- `components.json` — CLI config
- `src/lib/utils.ts` — `cn()` utility + type helpers
- Overwrites `src/app.css` — adds theme CSS variables (OKLCH), dark mode, `@theme inline`

Installs deps: `clsx`, `tailwind-merge`, `tailwind-variants`, `tw-animate-css`, `bits-ui`, `@lucide/svelte`

**After init:** add new deps to `pnpm-workspace.yaml` catalog. Move versions from `apps/web/package.json` to catalog, replace with `catalog:`.

## Adding Components

```bash
cd apps/web && pnpm dlx shadcn-svelte@latest add button card badge input
```

Multiple components at once is fine. Each creates a folder:

```
src/lib/components/ui/button/
  button.svelte    # Component (Svelte 5 runes)
  index.ts         # Re-exports
```

Flags:
- `-y` — skip confirmation
- `-o` — overwrite existing
- `-a` — install ALL components

## Usage in Svelte Files

```svelte
<script lang="ts">
  import { Button } from '$lib/components/ui/button/index.js';
  import * as Card from '$lib/components/ui/card/index.js';
</script>

<Button variant="outline">Click me</Button>

<Card.Root>
  <Card.Header>
    <Card.Title>Title</Card.Title>
  </Card.Header>
  <Card.Content>Content</Card.Content>
</Card.Root>
```

## Available Components

Common ones: `accordion`, `alert`, `alert-dialog`, `avatar`, `badge`, `breadcrumb`, `button`, `calendar`, `card`, `checkbox`, `collapsible`, `command`, `context-menu`, `data-table`, `dialog`, `drawer`, `dropdown-menu`, `form`, `hover-card`, `input`, `label`, `menubar`, `pagination`, `popover`, `progress`, `radio-group`, `scroll-area`, `select`, `separator`, `sheet`, `skeleton`, `slider`, `sonner` (toast), `switch`, `table`, `tabs`, `textarea`, `toggle`, `toggle-group`, `tooltip`.

## Dependencies Reference

| Package | Purpose |
|---------|---------|
| `bits-ui` | Headless UI primitives (dialog, menu, tooltip, etc.) |
| `tailwind-variants` | Variant-based styling (replaces cva) |
| `tailwind-merge` | Smart Tailwind class merging |
| `clsx` | Conditional class joining |
| `tw-animate-css` | CSS animations for Tailwind v4 |
| `@lucide/svelte` | Icons |

Component-specific (installed on demand):
| `vaul-svelte` | Drawer |
| `svelte-sonner` | Toast (sonner) |
| `paneforge` | Resizable panels |
| `formsnap` | Form handling |

## components.json Reference

```json
{
  "$schema": "https://shadcn-svelte.com/schema.json",
  "tailwind": {
    "css": "src/app.css",
    "baseColor": "neutral"
  },
  "aliases": {
    "lib": "$lib",
    "utils": "$lib/utils",
    "components": "$lib/components",
    "ui": "$lib/components/ui",
    "hooks": "$lib/hooks"
  },
  "typescript": true,
  "registry": "https://shadcn-svelte.com/registry"
}
```

## Post-Install Checklist

After adding components:
1. Check if new npm deps were added to `apps/web/package.json`
2. Move their versions to `pnpm-workspace.yaml` catalog
3. Replace versions in package.json with `catalog:`
4. Run `pnpm install` from root
5. Run `pnpm --filter=@opencruit/web lint` and `pnpm --filter=@opencruit/web typecheck`

## Notes

- Components are copy-pasted code, not a dependency — edit freely
- `baseColor` is set at init time and cannot be changed later without re-init
- Color format is OKLCH (Tailwind v4), not HSL
- All components use Svelte 5: `$props()`, `$bindable()`, `$state()`, `{@render children()}`
- Monorepo: no official support, but running from `apps/web/` works fine
