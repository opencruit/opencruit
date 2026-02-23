<script lang="ts">
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  let job = $derived(data.job);
</script>

<svelte:head>
  <title>{job.title} at {job.company} | OpenCruit</title>
</svelte:head>

<div class="mb-4">
  <a href="/" class="text-sm text-blue-600 hover:underline">&larr; Back to jobs</a>
</div>

<article class="rounded-lg border border-gray-200 bg-white p-6">
  <div class="flex items-start gap-4">
    {#if job.companyLogoUrl}
      <img src={job.companyLogoUrl} alt="{job.company} logo" class="h-16 w-16 rounded-lg object-contain" />
    {/if}
    <div>
      <h1 class="text-2xl font-bold">{job.title}</h1>
      <p class="text-lg text-gray-600">{job.company}</p>
    </div>
  </div>

  <div class="mt-4 flex flex-wrap gap-3 text-sm text-gray-600">
    {#if job.location}
      <span>{job.location}</span>
    {/if}
    {#if job.isRemote}
      <span class="rounded-full bg-green-100 px-2.5 py-0.5 text-green-800">Remote</span>
    {/if}
    {#if job.salary}
      <span class="font-medium">
        {#if job.salary.min && job.salary.max}
          ${job.salary.min.toLocaleString()}–${job.salary.max.toLocaleString()} {job.salary.currency ?? 'USD'}
        {:else if job.salary.min}
          ${job.salary.min.toLocaleString()}+ {job.salary.currency ?? 'USD'}
        {:else if job.salary.max}
          Up to ${job.salary.max.toLocaleString()} {job.salary.currency ?? 'USD'}
        {/if}
      </span>
    {/if}
  </div>

  {#if job.tags && job.tags.length > 0}
    <div class="mt-4 flex flex-wrap gap-2">
      {#each job.tags as tag (tag)}
        <span class="rounded bg-gray-100 px-2.5 py-1 text-sm text-gray-700">{tag}</span>
      {/each}
    </div>
  {/if}

  <div class="mt-6">
    <a
      href={job.applyUrl ?? job.url}
      target="_blank"
      rel="noopener noreferrer"
      class="inline-block rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
    >
      Apply
    </a>
  </div>

  <hr class="my-6 border-gray-200" />

  <div class="prose prose-sm max-w-none">
    {@html job.description}
  </div>
</article>
