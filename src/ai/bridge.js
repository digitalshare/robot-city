// Lets the dev server's HTTP API and MCP server drive this tab: jobs arrive over server-sent events,
// run through the AI chat like a typed command, and the outcome is posted back.

export function connectBridge(runCommand) {
  if (typeof EventSource === 'undefined') return null;
  const source = new EventSource('/__api/bridge');
  source.addEventListener('job', async (e) => {
    let job;
    try { job = JSON.parse(e.data); } catch { return; }
    const text = `${job.command} ${job.request}`.trim();
    let result;
    try {
      result = await runCommand(text);
    } catch (err) {
      result = { status: 'error', statusText: err && err.message ? err.message : 'Command failed.' };
    }
    try {
      await fetch('/__api/bridge/result', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jobId: job.jobId, ...result }),
      });
    } catch {
      // the server gives up on its own after a timeout
    }
  });
  return source;
}
