<script lang="ts">
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  let search = $state('');

  let filteredJobs = $derived(
    data.jobs.filter((job) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        job.title.toLowerCase().includes(q) ||
        job.company.toLowerCase().includes(q) ||
        (job.tags ?? []).some((t) => t.toLowerCase().includes(q))
      );
    }),
  );

  function formatSalary(salary: { min?: number; max?: number; currency?: string }): string {
    const fmt = (n: number) => `${Math.round(n / 1000)}k`;
    const currency = salary.currency ?? 'USD';
    if (salary.min && salary.max) return `${fmt(salary.min)}–${fmt(salary.max)} ${currency}`;
    if (salary.min) return `${fmt(salary.min)}+ ${currency}`;
    if (salary.max) return `up to ${fmt(salary.max)} ${currency}`;
    return '';
  }

  function timeAgo(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days === 0) return 'today';
    if (days === 1) return 'yesterday';
    return `${days}d ago`;
  }
</script>

<svelte:head>
  <title>Jobs | OpenCruit</title>
</svelte:head>

{#if data.error}
  <div class="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">
    {data.error}
  </div>
{/if}

<div class="mb-6">
  <input
    type="text"
    bind:value={search}
    placeholder="Search jobs, companies, or tags..."
    class="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
  />
</div>

<p class="mb-4 text-sm text-gray-500">{filteredJobs.length} jobs</p>

<div class="space-y-3">
  {#each filteredJobs as job (job.externalId)}
    <a
      href="/job/{encodeURIComponent(job.externalId)}"
      class="block rounded-lg border border-gray-200 bg-white p-4 transition-shadow hover:shadow-md"
    >
      <div class="flex items-start gap-4">
        {#if job.companyLogoUrl}
          <img
            src={job.companyLogoUrl}
            alt="{job.company} logo"
            class="h-12 w-12 shrink-0 rounded-lg object-contain"
          />
        {:else}
          <div
            class="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-lg font-bold text-gray-400"
          >
            {job.company.charAt(0)}
          </div>
        {/if}

        <div class="min-w-0 flex-1">
          <h2 class="text-base font-semibold text-gray-900">{job.title}</h2>
          <p class="text-sm text-gray-600">{job.company}</p>

          <div class="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
            {#if job.location}
              <span>{job.location}</span>
            {/if}
            {#if job.isRemote}
              <span class="rounded-full bg-green-100 px-2 py-0.5 text-green-800">Remote</span>
            {/if}
            {#if job.salary}
              <span class="font-medium text-gray-700">{formatSalary(job.salary)}</span>
            {/if}
            {#if job.postedAt}
              <span>{timeAgo(job.postedAt)}</span>
            {/if}
          </div>

          {#if job.tags && job.tags.length > 0}
            <div class="mt-2 flex flex-wrap gap-1.5">
              {#each job.tags.slice(0, 5) as tag (tag)}
                <span class="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{tag}</span>
              {/each}
              {#if job.tags.length > 5}
                <span class="text-xs text-gray-400">+{job.tags.length - 5}</span>
              {/if}
            </div>
          {/if}
        </div>
      </div>
    </a>
  {/each}
</div>

{#if filteredJobs.length === 0 && !data.error}
  <div class="py-12 text-center text-gray-500">
    {#if search}
      No jobs match "{search}". Try a different search.
    {:else}
      No jobs available right now.
    {/if}
  </div>
{/if}
