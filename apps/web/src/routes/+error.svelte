<script lang="ts">
  import { page } from '$app/state';
  import { Button } from '$lib/components/ui/button/index.js';
</script>

<div class="py-20 text-center">
  <h1 class="text-5xl font-bold text-foreground">{page.status}</h1>
  <p class="mt-3 text-muted-foreground">{page.error?.message ?? 'Something went wrong'}</p>
  <Button variant="ghost" href="/" class="mt-6">Go back to jobs</Button>
</div>
