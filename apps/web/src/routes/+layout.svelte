<script lang="ts">
  import '../app.css';
  import { ModeWatcher, toggleMode } from 'mode-watcher';
  import Sun from '@lucide/svelte/icons/sun';
  import Moon from '@lucide/svelte/icons/moon';
  import { Button } from '$lib/components/ui/button/index.js';

  let { children } = $props();
</script>

<ModeWatcher defaultMode="dark" />

<div class="min-h-screen bg-background text-foreground">
  <header class="sticky top-0 z-10 border-b border-border/50 bg-background/80 backdrop-blur-lg">
    <div class="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
      <a href="/" class="text-lg font-semibold tracking-tight">
        <span class="text-primary">Open</span><span class="text-muted-foreground">Cruit</span>
      </a>
      <Button variant="ghost" size="icon" onclick={toggleMode} aria-label="Toggle theme">
        <Sun class="hidden size-4 dark:block" />
        <Moon class="size-4 dark:hidden" />
      </Button>
    </div>
  </header>

  <main class="mx-auto max-w-6xl px-6 py-8">
    {@render children()}
  </main>
</div>
