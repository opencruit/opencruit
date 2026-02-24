<script lang="ts">
  import { page } from '$app/state';
  import { toggleMode } from 'mode-watcher';
  import Sun from '@lucide/svelte/icons/sun';
  import Moon from '@lucide/svelte/icons/moon';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Separator } from '$lib/components/ui/separator/index.js';

  let { children } = $props();

  const navItems = [
    { href: '/admin', label: 'Dashboard', icon: 'grid' },
    { href: '/admin/sources', label: 'Sources', icon: 'radio' },
    { href: '/admin/queues', label: 'Queues', icon: 'layers' },
    { href: '/admin/jobs', label: 'Jobs', icon: 'briefcase' },
  ] as const;

  function isActive(href: string): boolean {
    const path = page.url.pathname;
    if (href === '/admin') return path === '/admin';
    return path.startsWith(href);
  }
</script>

<div class="flex min-h-screen bg-background text-foreground">
  <aside class="sticky top-0 flex h-screen w-56 shrink-0 flex-col border-r border-border/50 bg-card">
    <div class="flex items-center gap-2 px-5 py-4">
      <a href="/admin" class="text-sm font-semibold tracking-tight">
        <span class="text-primary">Open</span><span class="text-muted-foreground">Cruit</span>
        <span class="ml-1.5 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">Admin</span>
      </a>
    </div>

    <Separator />

    <nav class="flex-1 space-y-0.5 px-3 py-3">
      {#each navItems as item (item.href)}
        <a
          href={item.href}
          class="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors {isActive(item.href)
            ? 'bg-accent text-accent-foreground font-medium'
            : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'}"
        >
          {item.label}
        </a>
      {/each}
    </nav>

    <Separator />

    <div class="px-3 py-3">
      <a
        href="/"
        class="flex items-center gap-2 rounded-md px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
      >
        &larr; Back to site
      </a>
    </div>
  </aside>

  <div class="flex flex-1 flex-col">
    <header class="flex items-center justify-between border-b border-border/50 px-6 py-3">
      <h1 class="text-sm font-medium text-muted-foreground">Administration</h1>
      <Button variant="ghost" size="icon" onclick={toggleMode} aria-label="Toggle theme">
        <Sun class="hidden size-4 dark:block" />
        <Moon class="size-4 dark:hidden" />
      </Button>
    </header>

    <main class="flex-1 p-6">
      {@render children()}
    </main>
  </div>
</div>
