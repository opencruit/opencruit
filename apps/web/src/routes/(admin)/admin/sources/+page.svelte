<script lang="ts">
  import type { PageData } from './$types';
  import * as Card from '$lib/components/ui/card/index.js';
  import * as Table from '$lib/components/ui/table/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Button } from '$lib/components/ui/button/index.js';

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
  <title>Sources | Admin | OpenCruit</title>
</svelte:head>

<div class="space-y-6">
  <h2 class="text-lg font-semibold">Sources</h2>

  <Card.Root>
    <Table.Root>
      <Table.Header>
        <Table.Row>
          <Table.Head>Source</Table.Head>
          <Table.Head>Kind</Table.Head>
          <Table.Head>Status</Table.Head>
          <Table.Head class="text-right">Active</Table.Head>
          <Table.Head class="text-right">Total</Table.Head>
          <Table.Head>Last Run</Table.Head>
          <Table.Head>Duration</Table.Head>
          <Table.Head>Failures</Table.Head>
          <Table.Head></Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {#each data.sources as source (source.id)}
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
            <Table.Cell class="text-right tabular-nums">{source.activeJobs.toLocaleString()}</Table.Cell>
            <Table.Cell class="text-right tabular-nums text-muted-foreground">
              {source.totalJobs.toLocaleString()}
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
            <Table.Cell>
              {#if source.kind === 'batch'}
                <form method="POST" action="?/triggerIngest">
                  <input type="hidden" name="sourceId" value={source.id} />
                  <Button variant="outline" size="sm" type="submit" class="h-7 text-xs">Ingest</Button>
                </form>
              {/if}
            </Table.Cell>
          </Table.Row>
        {/each}
      </Table.Body>
    </Table.Root>
  </Card.Root>
</div>
