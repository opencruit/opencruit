<script lang="ts">
  import '../app.css';

  let { children } = $props();
</script>

<div class="min-h-screen bg-background text-foreground">
  <header class="sticky top-0 z-10 border-b border-border/50 bg-background/80 backdrop-blur-lg">
    <div class="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
      <a href="/" class="text-lg font-semibold tracking-tight">
        <span class="text-primary">Open</span><span class="text-muted-foreground">Cruit</span>
      </a>
      <p class="text-xs text-muted-foreground">Open-source job aggregator</p>
    </div>
  </header>

  <main class="mx-auto max-w-6xl px-6 py-8">
    {@render children()}
  </main>
</div>
