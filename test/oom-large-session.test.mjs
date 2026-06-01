/**
 * Regression test for the desktop-mode OOM crash loop.
 * See docs/dev-logs/troubleshooting/2026-06-01-desktop-mode-oom-crash-loop.md
 *
 * Reading a large session JSONL fully into memory (the original getSessions /
 * getSessionMessages / Stop-hook / token-usage behavior) OOMed the dev service
 * under its 1G cgroup. This test generates a ~150MB session containing multi-MB
 * individual lines, then exercises the readers under a deliberately tight V8
 * heap (run via `--max-old-space-size=192`). The fixed head/tail readers touch
 * only KB and pass; any regression to a full read blows the heap and the
 * process exits non-zero — turning the CI/test run red.
 *
 * Run: pnpm run test:oom   (builds dist-server first via the `test` script)
 * It needs dist-server/projects.js to exist (compiled from server/).
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import v8 from 'node:v8';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Isolate from the real ~/.claude and from the running dev service by pointing
// HOME at a throwaway dir. getSessions/getSessionMessages resolve their project
// dir from process.env.HOME at call time, so this must be set before import.
const TEST_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'ccui-oom-test-'));
process.env.HOME = TEST_HOME;

const PROJECT = '-tmp-oom-regression';
const SESSION_ID = 'oomtest00-0000-4000-8000-000000000000';
const TARGET_BYTES = 150 * 1024 * 1024; // > any sane "read whole file" budget at 192MB heap
const HUGE_TEXT = 'x'.repeat(5 * 1024 * 1024); // 5MB line simulates an embedded tool result

function generate() {
  const dir = path.join(TEST_HOME, '.claude', 'projects', PROJECT);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${SESSION_ID}.jsonl`);

  const fd = fs.openSync(file, 'w');
  try {
    let bytes = 0;
    const t0 = Date.UTC(2026, 0, 1, 0, 0, 0);
    const write = (obj) => {
      const line = JSON.stringify(obj) + '\n';
      bytes += Buffer.byteLength(line);
      fs.writeSync(fd, line);
    };

    // First user message (head: drives grouping + summary fallback)
    write({
      type: 'user', sessionId: SESSION_ID, uuid: 'u-first', parentUuid: null,
      cwd: '/tmp/oom-regression', timestamp: new Date(t0).toISOString(),
      message: { role: 'user', content: 'first prompt for the OOM regression test' },
    });

    let i = 0;
    while (bytes < TARGET_BYTES) {
      const ts = new Date(t0 + (i + 1) * 1000).toISOString();
      // Periodically emit a multi-MB line (the spike that OOMed full reads).
      const text = i % 20 === 0 ? HUGE_TEXT : `assistant reply number ${i}`;
      write({
        type: 'assistant', sessionId: SESSION_ID, uuid: `a-${i}`, parentUuid: `u-${i}`,
        timestamp: ts,
        message: {
          role: 'assistant',
          content: [{ type: 'text', text }],
          usage: { input_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 100 + i },
        },
      });
      write({
        type: 'user', sessionId: SESSION_ID, uuid: `u-${i + 1}`, parentUuid: `a-${i}`,
        timestamp: new Date(t0 + (i + 1) * 1000 + 500).toISOString(),
        message: { role: 'user', content: `follow-up message ${i}` },
      });
      i++;
    }
    return { file, dir, lines: i };
  } finally {
    fs.closeSync(fd);
  }
}

async function main() {
  const { file } = generate();
  const sizeMB = (fs.statSync(file).size / 1048576).toFixed(0);
  const heapLimitMB = Math.round(v8.getHeapStatistics().heap_size_limit / 1048576);
  console.log(`[oom-test] generated ${sizeMB}MB session, heap limit = ${heapLimitMB}MB`);

  const { getSessions, getSessionMessages } = await import('../dist-server/projects.js');

  // getSessions — list metadata must come from head/tail, not a full scan.
  const list = await getSessions(PROJECT, 5, 0);
  const s = list.sessions.find((x) => x.id === SESSION_ID);
  assert(s, 'getSessions: large session must appear in the list');
  assert(s.lastActivity, 'getSessions: lastActivity present');
  assert(typeof s.summary === 'string' && s.summary.length > 0, 'getSessions: summary present');
  assert(typeof s.messageCount === 'number' && s.messageCount > 0, 'getSessions: messageCount estimated');

  // getSessionMessages — paginated reads must tail-read, not load the whole file.
  const page0 = await getSessionMessages(PROJECT, SESSION_ID, 30, 0);
  assert(Array.isArray(page0.messages), 'getSessionMessages: returns messages array');
  assert(page0.messages.length > 0 && page0.messages.length <= 30, 'getSessionMessages: page size bounded');
  assert(page0.total > 0, 'getSessionMessages: total > 0');
  assert(page0.hasMore === true, 'getSessionMessages: hasMore for a large session');

  const page1 = await getSessionMessages(PROJECT, SESSION_ID, 30, 30);
  assert(page1.messages.length > 0, 'getSessionMessages: load-more (offset=30) returns older messages');

  const peakMB = (process.memoryUsage().rss / 1048576).toFixed(0);
  console.log(`[oom-test] OK — readers completed, peak RSS ${peakMB}MB (no OOM)`);
}

main()
  .then(() => {
    fs.rmSync(TEST_HOME, { recursive: true, force: true });
    console.log('[oom-test] PASS');
    process.exit(0);
  })
  .catch((err) => {
    fs.rmSync(TEST_HOME, { recursive: true, force: true });
    console.error('[oom-test] FAIL:', err);
    process.exit(1);
  });
