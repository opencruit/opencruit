<script lang="ts">
  import type { PageData } from './$types';
  import * as Card from '$lib/components/ui/card/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import * as Table from '$lib/components/ui/table/index.js';

  let { data }: { data: PageData } = $props();

  function formatDuration(ms: number | null): string {
    if (ms === null) return '—';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }

  function timeAgo(iso: string | null): string {
    if (!iso) return 'never';
    const diff = Date.now() - new Date(iso).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }
</script>

<svelte:head>
  <title>Dashboard | Admin | OpenCruit</title>
</svelte:head>

<div class="space-y-6">
  <h2 class="text-lg font-semibold">Dashboard</h2>

  <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
    <Card.Root>
      <Card.Header class="pb-2">
        <Card.Title class="text-sm font-medium text-muted-foreground">Active Jobs</Card.Title>
      </Card.Header>
      <Card.Content>
        <p class="text-2xl font-bold">{data.overview.activeTotal.toLocaleString()}</p>
        <p class="mt-1 text-xs text-muted-foreground">
          {data.overview.archivedTotal.toLocaleString()} archived, {data.overview.missingTotal.toLocaleString()} missing
        </p>
      </Card.Content>
    </Card.Root>

    <Card.Root>
      <Card.Header class="pb-2">
        <Card.Title class="text-sm font-medium text-muted-foreground">New Last 24h</Card.Title>
      </Card.Header>
      <Card.Content>
        <p class="text-2xl font-bold">{data.overview.newLast24h.toLocaleString()}</p>
      </Card.Content>
    </Card.Root>

    <Card.Root>
      <Card.Header class="pb-2">
        <Card.Title class="text-sm font-medium text-muted-foreground">Healthy Sources</Card.Title>
      </Card.Header>
      <Card.Content>
        <p class="text-2xl font-bold text-emerald-500">{data.healthySources}</p>
      </Card.Content>
    </Card.Root>

    <Card.Root>
      <Card.Header class="pb-2">
        <Card.Title class="text-sm font-medium text-muted-foreground">Failing Sources</Card.Title>
      </Card.Header>
      <Card.Content>
        <p class="text-2xl font-bold {data.failingSources > 0 ? 'text-red-500' : 'text-muted-foreground'}">
          {data.failingSources}
        </p>
      </Card.Content>
    </Card.Root>
  </div>

  <div>
    <h3 class="mb-3 text-sm font-medium">Queue Health</h3>
    {#if data.queueHealth}
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {#each data.queueHealth as q (q.name)}
          <Card.Root class="p-4">
            <p class="text-xs font-medium text-muted-foreground">{q.label}</p>
            {@const wait = q.counts['wait'] ?? 0}
            {@const active = q.counts['active'] ?? 0}
            {@const failed = q.counts['failed'] ?? 0}
            {@const delayed = q.counts['delayed'] ?? 0}
            <div class="mt-2 flex items-center gap-3 text-xs">
              {#if wait > 0}
                <span class="text-yellow-500">{wait} wait</span>
              {/if}
              {#if active > 0}
                <span class="text-blue-500">{active} active</span>
              {/if}
              {#if failed > 0}
                <span class="text-red-500">{failed} failed</span>
              {/if}
              {#if delayed > 0}
                <span class="text-muted-foreground">{delayed} delayed</span>
              {/if}
              {#if wait === 0 && active === 0 && failed === 0 && delayed === 0}
                <span class="text-muted-foreground">idle</span>
              {/if}
            </div>
          </Card.Root>
        {/each}
      </div>
    {:else}
      <Card.Root class="p-4">
        <p class="text-sm text-muted-foreground">Redis not connected. Set REDIS_URL to see queue health.</p>
      </Card.Root>
    {/if}
  </div>

  <div>
    <h3 class="mb-3 text-sm font-medium">Source Health</h3>
    <Card.Root>
      <Table.Root>
        <Table.Header>
          <Table.Row>
            <Table.Head>Source</Table.Head>
            <Table.Head>Kind</Table.Head>
            <Table.Head>Status</Table.Head>
            <Table.Head>Last Run</Table.Head>
            <Table.Head>Duration</Table.Head>
            <Table.Head>Failures</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each data.sourceHealthSummary as source (source.id)}
            <Table.Row>
              <Table.Cell>
                <a href="/admin/sources/{source.id}" class="font-medium hover:underline">{source.label}</a>
              </Table.Cell>
              <Table.Cell>
                <span class="text-xs text-muted-foreground">{source.kind}</span>
              </Table.Cell>
              <Table.Cell>
                {#if source.status === 'healthy'}
                  <Badge variant="outline" class="border-emerald-500/30 text-emerald-500">healthy</Badge>
                {:else if source.status === 'failing'}
                  <Badge variant="destructive">failing</Badge>
                {:else}
                  <Badge variant="secondary">unknown</Badge>
                {/if}
              </Table.Cell>
              <Table.Cell class="text-xs text-muted-foreground">{timeAgo(source.lastRunAt)}</Table.Cell>
              <Table.Cell class="text-xs text-muted-foreground">{formatDuration(source.lastDurationMs)}</Table.Cell>
              <Table.Cell>
                {#if source.consecutiveFailures > 0}
                  <span class="text-xs font-medium text-red-500">{source.consecutiveFailures}</span>
                {:else}
                  <span class="text-xs text-muted-foreground">0</span>
                {/if}
              </Table.Cell>
            </Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
    </Card.Root>
  </div>
</div>
