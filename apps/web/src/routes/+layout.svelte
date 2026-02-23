<script lang="ts">
  import '../app.css';

  let { children } = $props();
</script>

<div class="min-h-screen bg-gray-50 text-gray-900">
  <header class="border-b border-gray-200 bg-white">
    <div class="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
      <a href="/" class="text-xl font-bold tracking-tight">OpenCruit</a>
      <span class="text-sm text-gray-500">Job Aggregator</span>
    </div>
  </header>

  <main class="mx-auto max-w-5xl px-4 py-8">
    {@render children()}
  </main>
</div>
