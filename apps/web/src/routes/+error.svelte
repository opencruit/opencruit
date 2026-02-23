<script lang="ts">
  import { page } from '$app/state';
</script>

<div class="py-12 text-center">
  <h1 class="text-4xl font-bold text-gray-900">{page.status}</h1>
  <p class="mt-2 text-gray-600">{page.error?.message ?? 'Something went wrong'}</p>
  <a href="/" class="mt-4 inline-block text-blue-600 hover:underline">Go back to jobs</a>
</div>
