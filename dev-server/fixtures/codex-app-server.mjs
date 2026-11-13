// Test-only App Server peer. Exercises real stdio framing and RPC ordering.
import { createInterface } from 'node:readline';
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
let initialized = false;
let mode;
let resumed = false;
const threadId = 'fixture-thread';
const turnId = 'fixture-turn';
function finish(outcome = 'review') {
  send({ method: 'item/completed', params: { threadId, turnId, item: { id: 'final', type: 'agentMessage', phase: 'final_answer', text: JSON.stringify({ outcome, summary: outcome === 'review' ? 'Implemented and checked the change. Test the story action.' : 'Which color should the button use?' }) } } });
  send({ method: 'turn/completed', params: { threadId, turn: { id: turnId, status: 'completed' } } });
}
for await (const line of createInterface({ input: process.stdin })) {
  const message = JSON.parse(line);
  if (message.method === 'initialize') {
    send({ id: message.id, result: { userAgent: 'fixture' } });
  } else if (message.method === 'initialized') initialized = true;
  else if (message.method === 'account/read') {
    send({ id: message.id, result: { account: { type: 'chatgpt' }, requiresOpenaiAuth: true } });
  } else if (message.method === 'thread/start' || message.method === 'thread/resume') {
    resumed = message.method === 'thread/resume';
    if (!initialized || message.params.sandbox !== 'workspace-write' || message.params.approvalPolicy !== 'on-request' || !message.params.cwd)
      send({ id: message.id, error: { code: -1, message: 'Unsafe thread configuration' } });
    else send({ id: message.id, result: { thread: { id: threadId } } });
  } else if (message.method === 'turn/start') {
    const text = message.params.input[0].text;
    if (text.includes('resume-check') && !resumed) process.exit(12);
    mode = /MODE:(\w+)/.exec(text)?.[1];
    send({ id: message.id, result: { turn: { id: turnId, status: 'inProgress' } } });
    send({ method: 'item/completed', params: { threadId, turnId, item: { id: 'progress', type: 'agentMessage', phase: 'commentary', text: 'Reading the project code.' } } });
    if (mode === 'crash') { process.exit(7); }
    else if (mode === 'approval' || mode === 'decline') {
      send({ id: 800, method: 'item/commandExecution/requestApproval', params: { threadId, turnId, itemId: 'command', command: 'npm run build', cwd: message.params.cwd, reason: 'Build requires approval' } });
    } else if (mode === 'file') {
      send({ method: 'item/started', params: { threadId, turnId, item: { id: 'patch', type: 'fileChange', changes: [{ path: 'example.txt', diff: '+example' }] } } });
      send({ id: 802, method: 'item/fileChange/requestApproval', params: { threadId, turnId, itemId: 'patch', reason: 'Review this patch' } });
    } else if (mode === 'question' || mode === 'longquestion') {
      send({ id: 801, method: 'item/tool/requestUserInput', params: { threadId, turnId, itemId: 'question', questions: [{ id: 'color', header: 'Color', question: 'Which color?', options: [{ label: 'Blue', description: 'Use blue' }] }] } });
    } else if (mode === 'needsinput') finish(text.includes('resume-check') ? 'review' : 'needs_input');
    else if (mode === 'environment') {
      if (process.env.CODEX_WINDOWS_REGISTERED_CORE || process.env.CODEX_APP_TOOLS_PIPE_PATH || process.env.CODEX_THREAD_ID) process.exit(21);
      if ((process.env.CODEX_HOME || '') !== process.env.DEVPILOT_EXPECT_CODEX_HOME) process.exit(22);
      finish();
    }
    else if (mode === 'malformed') process.stdout.write('invalid-json\n');
    else if (mode === 'context') {
      if (!text.includes('Important story note') || !text.includes('Acceptance example') || text.includes('Retired secret action') || text.includes('\"next_action\"') || !text.includes('\"history\"')) process.exit(9);
      finish();
    } else if (mode !== 'hang') finish();
  } else if (message.method === 'turn/interrupt') {
    send({ id: message.id, result: {} });
    send({ method: 'item/completed', params: { threadId, turnId, item: { id: 'stop-ack', type: 'agentMessage', phase: 'commentary', text: 'Codex acknowledged the stop request.' } } });
    send({ method: 'turn/completed', params: { threadId, turn: { id: turnId, status: 'interrupted' } } });
  } else if (message.id === 800 && !message.method) {
    if (message.result?.decision !== (mode === 'decline' ? 'decline' : 'accept')) process.exit(10);
    send({ method: 'serverRequest/resolved', params: { threadId, requestId: 800 } });
    finish();
  } else if (message.id === 801 && !message.method) {
    if (mode === 'question' && message.result?.answers?.color?.answers?.[0] !== 'Blue') process.exit(11);
    finish();
  } else if (message.id === 802 && !message.method) {
    if (message.result?.decision !== 'decline') process.exit(13);
    finish();
  }
}
