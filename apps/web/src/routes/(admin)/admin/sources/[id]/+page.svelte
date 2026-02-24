<script lang="ts">
  import type { PageData } from './$types';
  import * as Card from '$lib/components/ui/card/index.js';
  import * as Table from '$lib/components/ui/table/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  let { data }: { data: PageData } = $props();

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

  function formatDuration(ms: number | null): string {
    if (ms === null) return '—';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }
</script>

<svelte:head>
  <title>{data.source.label} | Sources | Admin | OpenCruit</title>
</svelte:head>

<div class="space-y-6">
  <div>
    <a href="/admin/sources" class="text-sm text-muted-foreground hover:text-foreground">&larr; Back to sources</a>
    <h2 class="mt-2 text-lg font-semibold">{data.source.label}</h2>
    <p class="text-sm text-muted-foreground">
      {data.source.kind} source &middot; <span class="font-mono text-xs">{data.source.id}</span>
    </p>
  </div>

  <div class="grid gap-4 sm:grid-cols-3">
    <Card.Root>
      <Card.Header class="pb-2">
        <Card.Title class="text-sm font-medium text-muted-foreground">Active Jobs</Card.Title>
      </Card.Header>
      <Card.Content>
        <p class="text-2xl font-bold">{(data.counts['active'] ?? 0).toLocaleString()}</p>
      </Card.Content>
    </Card.Root>
    <Card.Root>
      <Card.Header class="pb-2">
        <Card.Title class="text-sm font-medium text-muted-foreground">Archived</Card.Title>
      </Card.Header>
      <Card.Content>
        <p class="text-2xl font-bold text-muted-foreground">{(data.counts['archived'] ?? 0).toLocaleString()}</p>
      </Card.Content>
    </Card.Root>
    <Card.Root>
      <Card.Header class="pb-2">
        <Card.Title class="text-sm font-medium text-muted-foreground">Missing</Card.Title>
      </Card.Header>
      <Card.Content>
        <p class="text-2xl font-bold text-muted-foreground">{(data.counts['missing'] ?? 0).toLocaleString()}</p>
      </Card.Content>
    </Card.Root>
  </div>

  <div>
    <h3 class="mb-3 text-sm font-medium">Health by Stage</h3>
    <Card.Root>
      {#if data.stages.length === 0}
        <div class="p-6 text-center text-sm text-muted-foreground">No health data yet. Worker has not run this source.</div>
      {:else}
        <Table.Root>
          <Table.Header>
            <Table.Row>
              <Table.Head>Stage</Table.Head>
              <Table.Head>Status</Table.Head>
              <Table.Head>Last Run</Table.Head>
              <Table.Head>Last Success</Table.Head>
              <Table.Head>Duration</Table.Head>
              <Table.Head>Failures</Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {#each data.stages as stage (stage.stage)}
              <Table.Row>
                <Table.Cell class="font-mono text-xs">{stage.stage}</Table.Cell>
                <Table.Cell>
                  {#if stage.status === 'healthy'}
                    <Badge variant="outline" class="border-emerald-500/30 text-emerald-500">healthy</Badge>
                  {:else}
                    <Badge variant="destructive">failing</Badge>
                  {/if}
                </Table.Cell>
                <Table.Cell class="text-xs text-muted-foreground">{timeAgo(stage.lastRunAt)}</Table.Cell>
                <Table.Cell class="text-xs text-muted-foreground">{timeAgo(stage.lastSuccessAt)}</Table.Cell>
                <Table.Cell class="text-xs text-muted-foreground">{formatDuration(stage.lastDurationMs)}</Table.Cell>
                <Table.Cell>
                  {#if stage.consecutiveFailures > 0}
                    <span class="text-xs font-medium text-red-500">{stage.consecutiveFailures}</span>
                  {:else}
                    <span class="text-xs text-muted-foreground">0</span>
                  {/if}
                </Table.Cell>
              </Table.Row>
              {#if stage.lastError}
                <Table.Row>
                  <Table.Cell colspan={6}>
                    <pre class="max-h-32 overflow-auto rounded bg-destructive/10 p-3 text-xs text-red-400">{stage.lastError}</pre>
                  </Table.Cell>
                </Table.Row>
              {/if}
            {/each}
          </Table.Body>
        </Table.Root>
      {/if}
    </Card.Root>
  </div>

  {#if data.cursors.length > 0}
    <div>
      <h3 class="mb-3 text-sm font-medium">Cursors</h3>
      <Card.Root>
        <Table.Root>
          <Table.Header>
            <Table.Row>
              <Table.Head>Segment</Table.Head>
              <Table.Head>Last Polled</Table.Head>
              <Table.Head>Cursor</Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {#each data.cursors as cursor (cursor.segmentKey)}
              <Table.Row>
                <Table.Cell class="font-mono text-xs">{cursor.segmentKey}</Table.Cell>
                <Table.Cell class="text-xs text-muted-foreground">{timeAgo(cursor.lastPolledAt)}</Table.Cell>
                <Table.Cell>
                  {#if cursor.cursor}
                    <pre class="max-w-xs truncate text-xs text-muted-foreground">{JSON.stringify(cursor.cursor)}</pre>
                  {:else}
                    <span class="text-xs text-muted-foreground">—</span>
                  {/if}
                </Table.Cell>
              </Table.Row>
            {/each}
          </Table.Body>
        </Table.Root>
      </Card.Root>
    </div>
  {/if}

  <div>
    <h3 class="mb-3 text-sm font-medium">Recent Jobs</h3>
    <Card.Root>
      {#if data.recentJobs.length === 0}
        <div class="p-6 text-center text-sm text-muted-foreground">No jobs from this source yet.</div>
      {:else}
        <Table.Root>
          <Table.Header>
            <Table.Row>
              <Table.Head>Title</Table.Head>
              <Table.Head>Company</Table.Head>
              <Table.Head>Status</Table.Head>
              <Table.Head>First Seen</Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {#each data.recentJobs as job (job.externalId)}
              <Table.Row>
                <Table.Cell>
                  <a href="/job/{encodeURIComponent(job.externalId)}" class="text-sm hover:underline">{job.title}</a>
                </Table.Cell>
                <Table.Cell class="text-sm text-muted-foreground">{job.company}</Table.Cell>
                <Table.Cell>
                  {#if job.status === 'active'}
                    <Badge variant="outline" class="border-emerald-500/30 text-emerald-500">active</Badge>
                  {:else if job.status === 'archived'}
                    <Badge variant="secondary">archived</Badge>
                  {:else}
                    <Badge variant="secondary">missing</Badge>
                  {/if}
                </Table.Cell>
                <Table.Cell class="text-xs text-muted-foreground">{timeAgo(job.firstSeenAt)}</Table.Cell>
              </Table.Row>
            {/each}
          </Table.Body>
        </Table.Root>
      {/if}
    </Card.Root>
  </div>
</div>
