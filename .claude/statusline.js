#!/usr/bin/env node
// Claude Code statusline for the RDT project (budgeting_gmf).
// Claude Code pipes a JSON blob on stdin every turn; we print one line back.
//
// Shows, best-effort from the fields Claude Code actually provides:
//   1. model.display_name (+ agent.name if this session was started with --agent)
//   2. context_window.used_percentage (pre-calculated by Claude Code; falls
//      back to a rough estimate from raw token counts if that field is null,
//      and is clearly labelled "(est)" when we had to compute it ourselves)
//   3. cost.total_cost_usd, if the installed Claude Code version sends a
//      "cost" object; otherwise reported as "cost n/a" (not invented)
//
// NOTE: subagents invoked mid-session via the Task tool (e.g. this project's
// fable-orchestrator, fable-advisor, senior-advisor, worker) do NOT appear
// here. The statusline JSON only exposes agent identity for a session
// started directly with `claude --agent <name>`; there is no field that
// reports "a Task-tool subagent is currently running".

let raw = '';
process.stdin.on('data', (chunk) => { raw += chunk; });
process.stdin.on('end', () => {
  let data;
  try {
    data = JSON.parse(raw || '{}');
  } catch (err) {
    process.stdout.write('[statusline: bad JSON input]');
    return;
  }

  // 1. Model (+ agent, when the whole session is an --agent session)
  const modelName = (data.model && data.model.display_name) || 'unknown-model';
  const agentName = data.agent && data.agent.name;
  const modelPart = agentName ? `${modelName} (${agentName})` : modelName;

  // 2. Context window usage
  const cw = data.context_window || {};
  let ctxPart;
  if (typeof cw.used_percentage === 'number') {
    ctxPart = `Ctx ${cw.used_percentage.toFixed(0)}%`;
  } else if (
    cw.current_usage &&
    typeof cw.context_window_size === 'number' &&
    cw.context_window_size > 0
  ) {
    const u = cw.current_usage;
    const usedTokens =
      (u.input_tokens || 0) +
      (u.output_tokens || 0) +
      (u.cache_creation_input_tokens || 0) +
      (u.cache_read_input_tokens || 0);
    const pct = Math.min(100, (usedTokens / cw.context_window_size) * 100);
    ctxPart = `Ctx ~${pct.toFixed(0)}% (est)`;
  } else {
    ctxPart = 'Ctx n/a';
  }

  // 3. Session cost, only if Claude Code actually sent it
  let costPart;
  if (data.cost && typeof data.cost.total_cost_usd === 'number') {
    costPart = `$${data.cost.total_cost_usd.toFixed(4)}`;
  } else {
    costPart = 'cost n/a';
  }

  // Dim color so it reads well against Claude Code's footer colors.
  process.stdout.write(`\x1b[2m[${modelPart}]\x1b[0m ${ctxPart} | ${costPart}`);
});
