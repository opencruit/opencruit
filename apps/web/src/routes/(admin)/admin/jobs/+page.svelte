<script lang="ts">
  import type { PageData } from './$types';
  import * as Card from '$lib/components/ui/card/index.js';
  import * as Table from '$lib/components/ui/table/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { getSourceLabel } from '$lib/sources.js';

  let { data }: { data: PageData } = $props();

  function timeAgo(iso: string | null): string {
    if (!iso) return '—';
    const diff = Date.now() - new Date(iso).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  function buildPageHref(page: number): string {
    const parts: string[] = [];
    if (data.filters.query) parts.push(`q=${encodeURIComponent(data.filters.query)}`);
    if (data.filters.source) parts.push(`source=${encodeURIComponent(data.filters.source)}`);
    if (data.filters.status) parts.push(`status=${encodeURIComponent(data.filters.status)}`);
    if (data.filters.from) parts.push(`from=${encodeURIComponent(data.filters.from)}`);
    if (data.filters.to) parts.push(`to=${encodeURIComponent(data.filters.to)}`);
    if (page > 1) parts.push(`page=${page}`);
    const qs = parts.join('&');
    return qs ? `/admin/jobs?${qs}` : '/admin/jobs';
  }
</script>

<svelte:head>
  <title>Jobs Browser | Admin | OpenCruit</title>
</svelte:head>

<div class="space-y-6">
  <h2 class="text-lg font-semibold">Jobs Browser</h2>

  <form method="GET" class="space-y-3">
    <div class="flex items-end gap-2">
      <div class="min-w-0 flex-1">
        <label for="q" class="mb-1 block text-xs text-muted-foreground">Search</label>
        <Input id="q" name="q" type="text" value={data.filters.query} placeholder="Title, company..." class="h-8" />
      </div>
      <div class="flex items-end gap-2">
        <Button type="submit" size="sm" class="h-8 shrink-0">Filter</Button>
        {#if data.filters.query || data.filters.source || data.filters.status || data.filters.from || data.filters.to}
          <Button variant="ghost" size="sm" href="/admin/jobs" class="h-8 shrink-0 text-xs">Clear</Button>
        {/if}
      </div>
    </div>

    <div class="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <div class="w-full min-w-0">
        <label for="source" class="mb-1 block text-xs text-muted-foreground">Source</label>
        <select
          id="source"
          name="source"
          class="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
          value={data.filters.source}
        >
          <option value="">All sources</option>
          {#each data.sources as source (source.id)}
            <option value={source.id}>{source.label}</option>
          {/each}
        </select>
      </div>

      <div class="w-full min-w-0">
        <label for="status" class="mb-1 block text-xs text-muted-foreground">Status</label>
        <select
          id="status"
          name="status"
          class="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
          value={data.filters.status}
        >
          <option value="">All</option>
          <option value="active">Active</option>
          <option value="archived">Archived</option>
          <option value="missing">Missing</option>
        </select>
      </div>

      <div class="w-full min-w-0">
        <label for="from" class="mb-1 block text-xs text-muted-foreground">From</label>
        <Input id="from" name="from" type="date" value={data.filters.from} class="h-8 text-xs" />
      </div>

      <div class="w-full min-w-0">
        <label for="to" class="mb-1 block text-xs text-muted-foreground">To</label>
        <Input id="to" name="to" type="date" value={data.filters.to} class="h-8 text-xs" />
      </div>
    </div>
  </form>

  <p class="text-xs text-muted-foreground">{data.pagination.total.toLocaleString()} jobs found</p>

  <Card.Root>
    {#if data.jobs.length === 0}
      <div class="p-8 text-center text-sm text-muted-foreground">No jobs match the current filters.</div>
    {:else}
      <div class="overflow-x-auto">
        <Table.Root class="table-fixed min-w-full">
          <Table.Header>
            <Table.Row>
              <Table.Head class="w-[34%]">Title</Table.Head>
              <Table.Head class="w-[18%]">Company</Table.Head>
              <Table.Head class="w-[10%]">Source</Table.Head>
              <Table.Head class="w-[10%]">Status</Table.Head>
              <Table.Head class="w-[28%]">Location</Table.Head>
              <Table.Head class="sticky right-0 z-10 w-[110px] whitespace-nowrap bg-card">
                First Seen
              </Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {#each data.jobs as job (job.id)}
              <Table.Row>
                <Table.Cell class="max-w-[360px]">
                  <a
                    href="/job/{encodeURIComponent(job.externalId)}"
                    class="line-clamp-1 text-sm font-medium hover:underline"
                    title={job.title}
                  >
                    {job.title}
                  </a>
                </Table.Cell>
                <Table.Cell class="text-sm text-muted-foreground">
                  <span class="block truncate" title={job.company}>{job.company}</span>
                </Table.Cell>
                <Table.Cell>
                  <Badge variant="secondary" class="text-[10px]">{getSourceLabel(job.sourceId)}</Badge>
                </Table.Cell>
                <Table.Cell>
                  {#if job.status === 'active'}
                    <Badge variant="outline" class="border-emerald-500/30 text-emerald-500 text-[10px]">active</Badge>
                  {:else if job.status === 'archived'}
                    <Badge variant="secondary" class="text-[10px]">archived</Badge>
                  {:else}
                    <Badge variant="secondary" class="text-[10px]">missing</Badge>
                  {/if}
                </Table.Cell>
                <Table.Cell class="text-xs text-muted-foreground whitespace-normal">
                  <span class="line-clamp-2 break-words" title={job.location || '—'}>
                    {job.location || '—'}
                  </span>
                  {#if job.isRemote}
                    <span class="ml-1 text-emerald-500">remote</span>
                  {/if}
                </Table.Cell>
                <Table.Cell class="sticky right-0 z-[1] whitespace-nowrap bg-card text-xs text-muted-foreground">
                  {timeAgo(job.firstSeenAt)}
                </Table.Cell>
              </Table.Row>
            {/each}
          </Table.Body>
        </Table.Root>
      </div>
    {/if}
  </Card.Root>

  {#if data.pagination.totalPages > 1}
    <div class="flex items-center justify-between">
      <p class="text-xs text-muted-foreground">
        Page {data.pagination.page} of {data.pagination.totalPages}
      </p>
      <div class="flex gap-2">
        {#if data.pagination.page > 1}
          <Button variant="outline" size="sm" href={buildPageHref(data.pagination.page - 1)}>Previous</Button>
        {/if}
        {#if data.pagination.page < data.pagination.totalPages}
          <Button variant="outline" size="sm" href={buildPageHref(data.pagination.page + 1)}>Next</Button>
        {/if}
      </div>
    </div>
  {/if}
</div>
