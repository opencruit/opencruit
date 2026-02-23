<script lang="ts">
  import type { PageData } from './$types';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Button } from '$lib/components/ui/button/index.js';

  let { data }: { data: PageData } = $props();

  function formatSalary(salary: { min?: number; max?: number; currency?: string }): string {
    const fmt = (n: number) => `${Math.round(n / 1000)}k`;
    const currency = salary.currency ?? 'USD';
    if (salary.min !== undefined && salary.max !== undefined) return `${fmt(salary.min)}–${fmt(salary.max)} ${currency}`;
    if (salary.min !== undefined) return `${fmt(salary.min)}+ ${currency}`;
    if (salary.max !== undefined) return `up to ${fmt(salary.max)} ${currency}`;
    return '';
  }

  function buildPageHref(page: number): string {
    const params: string[] = [];
    if (data.filters.query) params.push(`q=${encodeURIComponent(data.filters.query)}`);
    if (page > 1) params.push(`page=${page}`);
    const query = params.join('&');
    return query ? `/?${query}` : '/';
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

<form method="GET" class="mb-8 flex items-center gap-3">
  <Input
    name="q"
    type="text"
    value={data.filters.query}
    placeholder="Search jobs, companies, or tags..."
    class="flex-1"
  />
  <Button type="submit" size="sm">Search</Button>
  {#if data.filters.query}
    <Button variant="ghost" size="sm" href="/">Clear</Button>
  {/if}
</form>

<p class="mb-4 text-sm text-muted-foreground">{data.pagination.total} jobs found</p>

<div class="grid gap-3">
  {#each data.jobs as job (job.externalId)}
    <a
      href="/job/{encodeURIComponent(job.externalId)}"
      class="group rounded-xl border border-border/50 bg-card p-5 transition-all hover:border-border hover:bg-accent/50"
    >
      <div class="flex items-start gap-4">
        {#if job.companyLogoUrl}
          <img
            src={job.companyLogoUrl}
            alt="{job.company} logo"
            class="h-11 w-11 shrink-0 rounded-lg bg-muted object-contain p-0.5"
          />
        {:else}
          <div
            class="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-muted text-sm font-semibold text-muted-foreground"
          >
            {job.company.charAt(0)}
          </div>
        {/if}

        <div class="min-w-0 flex-1">
          <div class="flex items-baseline justify-between gap-4">
            <h2 class="truncate text-sm font-medium text-foreground group-hover:text-primary">
              {job.title}
            </h2>
            {#if job.postedAt}
              <span class="shrink-0 text-xs text-muted-foreground">{timeAgo(job.postedAt)}</span>
            {/if}
          </div>

          <p class="mt-0.5 text-sm text-muted-foreground">{job.company}</p>

          <div class="mt-2.5 flex flex-wrap items-center gap-2">
            {#if job.location}
              <span class="text-xs text-muted-foreground">{job.location}</span>
            {/if}
            {#if job.isRemote}
              <span class="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-400">
                Remote
              </span>
            {/if}
            {#if job.salary}
              <span class="text-xs font-medium text-foreground">{formatSalary(job.salary)}</span>
            {/if}
          </div>

          {#if job.tags && job.tags.length > 0}
            <div class="mt-2.5 flex flex-wrap gap-1.5">
              {#each job.tags.slice(0, 4) as tag, i (i)}
                <span class="rounded-md bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">{tag}</span>
              {/each}
              {#if job.tags.length > 4}
                <span class="px-1 text-xs text-muted-foreground">+{job.tags.length - 4}</span>
              {/if}
            </div>
          {/if}
        </div>
      </div>
    </a>
  {/each}
</div>

{#if data.jobs.length === 0}
  <div class="py-16 text-center">
    {#if data.filters.query}
      <p class="text-muted-foreground">No jobs match "<span class="text-foreground">{data.filters.query}</span>"</p>
      <Button variant="ghost" size="sm" class="mt-3" href="/">Clear search</Button>
    {:else}
      <p class="text-muted-foreground">No jobs available right now.</p>
    {/if}
  </div>
{/if}

{#if data.pagination.totalPages > 1}
  <div class="mt-6 flex items-center justify-between gap-3">
    <p class="text-xs text-muted-foreground">
      Page {data.pagination.page} of {data.pagination.totalPages}
    </p>
    <div class="flex items-center gap-2">
      {#if data.pagination.page > 1}
        <Button variant="outline" size="sm" href={buildPageHref(data.pagination.page - 1)}>Previous</Button>
      {/if}
      {#if data.pagination.page < data.pagination.totalPages}
        <Button variant="outline" size="sm" href={buildPageHref(data.pagination.page + 1)}>Next</Button>
      {/if}
    </div>
  </div>
{/if}
