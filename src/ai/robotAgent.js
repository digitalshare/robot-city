export async function chatWithRobot(robot, message) {
  let response;
  try {
    response = await fetch('/__robot-chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        robotId: robot.agentKey || `robot:${robot.id}`,
        robot,
        message,
      }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    return { ok: false, message: 'Robot agent service is unavailable.' };
  }
  let data = null;
  try { data = await response.json(); } catch { /* handled as a generic failure */ }
  if (!response.ok) {
    return { ok: false, message: data?.error || `Robot agent request failed (${response.status}).` };
  }
  if (typeof data?.reply !== 'string' || !data.reply.trim()) {
    return { ok: false, message: 'Robot agent returned no reply.' };
  }
  return { ok: true, reply: data.reply, provider: data.provider || 'agent' };
}
