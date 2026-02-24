<script lang="ts">
  import type { PageData } from './$types';
  import * as Card from '$lib/components/ui/card/index.js';
  import * as Table from '$lib/components/ui/table/index.js';
  import { Button } from '$lib/components/ui/button/index.js';

  let { data }: { data: PageData } = $props();

  function formatTimestamp(ts: number): string {
    if (!ts) return '—';
    return new Date(ts).toLocaleString();
  }
</script>

<svelte:head>
  <title>Queues | Admin | OpenCruit</title>
</svelte:head>

<div class="space-y-6">
  <h2 class="text-lg font-semibold">Queues</h2>

  {#if !data.queues}
    <Card.Root class="p-6">
      <p class="text-sm text-muted-foreground">Redis not connected. Set REDIS_URL to manage queues.</p>
    </Card.Root>
  {:else}
  <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
    {#each data.queues as q (q.name)}
      {@const wait = q.counts['wait'] ?? 0}
      {@const active = q.counts['active'] ?? 0}
      {@const failed = q.counts['failed'] ?? 0}
      {@const delayed = q.counts['delayed'] ?? 0}
      {@const completed = q.counts['completed'] ?? 0}
      <a
        href="/admin/queues?tab={q.name}"
        class="rounded-lg border p-4 transition-colors {data.activeTab === q.name
          ? 'border-primary bg-accent/50'
          : 'border-border/50 hover:border-border'}"
      >
        <p class="text-xs font-medium">{q.label}</p>
        <div class="mt-2 flex flex-wrap gap-2 text-xs">
          {#if wait > 0}<span class="text-yellow-500">{wait} wait</span>{/if}
          {#if active > 0}<span class="text-blue-500">{active} active</span>{/if}
          {#if failed > 0}<span class="text-red-500">{failed} failed</span>{/if}
          {#if delayed > 0}<span class="text-muted-foreground">{delayed} delayed</span>{/if}
          {#if wait === 0 && active === 0 && failed === 0 && delayed === 0}
            <span class="text-muted-foreground">idle</span>
          {/if}
        </div>
        <p class="mt-1 text-[10px] text-muted-foreground">{completed} completed</p>
      </a>
    {/each}
  </div>

  {#if data.queues?.find((q) => q.name === data.activeTab)}
    {@const activeQueue = data.queues!.find((q) => q.name === data.activeTab)!}
    <Card.Root>
      <Card.Header>
        <Card.Title class="text-sm font-medium">{activeQueue.label} — Failed Jobs</Card.Title>
      </Card.Header>
      <Card.Content>
        {#if activeQueue.failedJobs.length === 0}
          <p class="text-sm text-muted-foreground">No failed jobs in this queue.</p>
        {:else}
          <div class="mb-3 flex justify-end">
            <form method="POST" action="?/cleanFailed">
              <input type="hidden" name="queue" value={activeQueue.name} />
              <Button variant="destructive" size="sm" type="submit" class="h-7 text-xs">Clean All Failed</Button>
            </form>
          </div>
          <Table.Root>
            <Table.Header>
              <Table.Row>
                <Table.Head>Job ID</Table.Head>
                <Table.Head>Name</Table.Head>
                <Table.Head>Failed Reason</Table.Head>
                <Table.Head>Attempts</Table.Head>
                <Table.Head>Time</Table.Head>
                <Table.Head></Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {#each activeQueue.failedJobs as job (job.id)}
                <Table.Row>
                  <Table.Cell class="font-mono text-xs">{job.id}</Table.Cell>
                  <Table.Cell class="text-xs">{job.name}</Table.Cell>
                  <Table.Cell>
                    <span class="max-w-xs truncate text-xs text-red-400" title={job.failedReason}>
                      {job.failedReason.slice(0, 120)}
                    </span>
                  </Table.Cell>
                  <Table.Cell class="text-xs text-muted-foreground">{job.attemptsMade}</Table.Cell>
                  <Table.Cell class="text-xs text-muted-foreground">{formatTimestamp(job.timestamp)}</Table.Cell>
                  <Table.Cell>
                    <div class="flex gap-1">
                      <form method="POST" action="?/retryJob">
                        <input type="hidden" name="queue" value={activeQueue.name} />
                        <input type="hidden" name="jobId" value={job.id} />
                        <Button variant="outline" size="sm" type="submit" class="h-6 text-[10px]">Retry</Button>
                      </form>
                      <form method="POST" action="?/removeJob">
                        <input type="hidden" name="queue" value={activeQueue.name} />
                        <input type="hidden" name="jobId" value={job.id} />
                        <Button variant="ghost" size="sm" type="submit" class="h-6 text-[10px] text-red-400">
                          Remove
                        </Button>
                      </form>
                    </div>
                  </Table.Cell>
                </Table.Row>
              {/each}
            </Table.Body>
          </Table.Root>
        {/if}
      </Card.Content>
    </Card.Root>
  {/if}
  {/if}
</div>
