<script lang="ts">
  import type { PageData } from './$types';
  import { Button } from '$lib/components/ui/button/index.js';

  const sourceLabels: Record<string, string> = {
    hh: 'HeadHunter',
    remoteok: 'RemoteOK',
    weworkremotely: 'WeWorkRemotely',
    remotive: 'Remotive',
    arbeitnow: 'Arbeitnow',
    jobicy: 'Jobicy',
    himalayas: 'Himalayas',
    adzuna: 'Adzuna',
    jooble: 'Jooble',
    greenhouse: 'Greenhouse',
    lever: 'Lever',
    smartrecruiters: 'SmartRecruiters',
  };

  let { data }: { data: PageData } = $props();
  let job = $derived(data.job);
  let sourceLabel = $derived(sourceLabels[job.sourceId] ?? job.sourceId);
</script>

<svelte:head>
  <title>{job.title} at {job.company} | OpenCruit</title>
</svelte:head>

<div class="mb-6">
  <a href="/" class="text-sm text-muted-foreground transition-colors hover:text-foreground">&larr; Back to jobs</a>
</div>

<article class="rounded-xl border border-border/50 bg-card p-8">
  <div class="flex items-start gap-5">
    {#if job.companyLogoUrl}
      <img
        src={job.companyLogoUrl}
        alt="{job.company} logo"
        class="h-14 w-14 rounded-xl bg-muted object-contain p-1"
      />
    {/if}
    <div>
      <h1 class="text-xl font-semibold text-foreground">{job.title}</h1>
      <p class="mt-1 text-muted-foreground">{job.company}</p>
    </div>
  </div>

  <div class="mt-5 flex flex-wrap items-center gap-2.5 text-sm">
    {#if job.location}
      <span class="text-muted-foreground">{job.location}</span>
    {/if}
    {#if job.isRemote}
      <span class="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-0.5 text-xs text-emerald-400">
        Remote
      </span>
    {/if}
    <span class="rounded-full border border-blue-500/20 bg-blue-500/10 px-2.5 py-0.5 text-xs text-blue-400">
      {sourceLabel}
    </span>
    {#if job.salary}
      <span class="font-medium text-foreground">
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
    <div class="mt-5 flex flex-wrap gap-1.5">
      {#each job.tags as tag (tag)}
        <span class="rounded-md bg-secondary px-2.5 py-1 text-xs text-secondary-foreground">{tag}</span>
      {/each}
    </div>
  {/if}

  <div class="mt-6">
    <Button href={job.applyUrl ?? job.url} target="_blank" rel="noopener noreferrer">
      Apply for this position
    </Button>
  </div>

  <hr class="my-8 border-border/50" />

  {#if job.descriptionRich}
    <div class="prose prose-sm prose-invert max-w-none text-muted-foreground [&_a]:text-primary [&_a]:underline [&_h1]:text-foreground [&_h2]:text-foreground [&_h3]:text-foreground [&_strong]:text-foreground [&_li]:marker:text-muted-foreground">
      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
      {@html job.descriptionRich}
    </div>
  {:else}
    <div class="max-w-none whitespace-pre-wrap text-sm leading-7 text-muted-foreground">
      {job.description}
    </div>
  {/if}
</article>
