// Regression checks for the fork's workflow integration. No live posts are sent.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

async function runWorkflow({ callbackFails = false, enrichmentFails = false, publishFails = false } = {}) {
  const calls = [];
  class ApplicationFailure extends Error { constructor(message) { super(message); this.type = 'bad_body'; } }
  class ActivityFailure extends Error { constructor(cause) { super('activity failed'); this.cause = cause; } }
  const post = { id: 'post-1', organizationId: 'org-1', state: 'QUEUE', settings: '{}', integration: { id: 'channel-1', organizationId: 'org-1', providerIdentifier: 'test', name: 'Test channel' } };
  const activities = new Proxy({}, { get: (_, name) => async (...args) => {
    calls.push({ name, args });
    switch (name) {
      case 'getPost': return post;
      case 'getPostsList': return [post];
      case 'enrichPostMetadata': if (enrichmentFails) throw Error('CF unavailable'); return;
      case 'notifyContentFactory': if (callbackFails) throw Error('CF unavailable'); return;
      case 'postSocialPending':
        if (publishFails) throw new ActivityFailure(new ApplicationFailure('Invalid media'));
        return [{ id: post.id, postId: 'live-1', releaseURL: 'https://example.test/live-1' }];
      case 'globalPlugs': case 'internalPlugs': return [];
      default: return undefined;
    }
  }});
  const source = fs.readFileSync(path.join(__dirname, '../../apps/orchestrator/src/workflows/post-workflows/post.workflow.v1.1.3.ts'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, {
    exports, Date, console,
    require: (name) => {
      if (name === '@temporalio/workflow') return { ActivityFailure, ApplicationFailure, proxyActivities: () => activities, sleep: async () => {}, defineSignal: () => 'poke', setHandler: () => {} };
      if (name === '@temporalio/common') return { TimeoutFailure: class extends Error {}, TimeoutType: {} };
      if (name.includes('temporal.search.attribute')) return { postId: {} };
      if (name.includes('services/make.is')) return { makeId: () => 'repeat' };
      return require(name);
    },
  });
  await exports.postWorkflowV113({ taskQueue: 'test', postId: post.id, organizationId: post.organizationId, postNow: true });
  return calls;
}

test('enriches before publishing and reports the live URL to Content Factory', async () => {
  const calls = await runWorkflow();
  assert(calls.findIndex(c => c.name === 'enrichPostMetadata') < calls.findIndex(c => c.name === 'getPostsList'));
  assert.equal(calls.filter(c => c.name === 'postSocialPending').length, 1);
  assert.deepEqual(calls.find(c => c.name === 'notifyContentFactory').args, ['post-1', 'PUBLISHED', 'test', 'Test channel', 'https://example.test/live-1', undefined]);
  assert.equal(calls.filter(c => c.name === 'sendWebhooks').length, 1);
});
test('Content Factory outages never re-publish an accepted post or prevent webhooks', async () => {
  const calls = await runWorkflow({ callbackFails: true, enrichmentFails: true });
  assert.equal(calls.filter(c => c.name === 'postSocialPending').length, 1);
  assert.equal(calls.filter(c => c.name === 'updatePost').length, 1);
  assert.equal(calls.filter(c => c.name === 'sendWebhooks').length, 1);
});
test('provider rejection records ERROR and reports it without another publish attempt', async () => {
  const calls = await runWorkflow({ publishFails: true });
  assert.equal(calls.filter(c => c.name === 'postSocialPending').length, 1);
  assert.equal(calls.find(c => c.name === 'changeState').args[1], 'ERROR');
  assert.equal(calls.find(c => c.name === 'notifyContentFactory').args[1], 'ERROR');
  assert.equal(calls.filter(c => c.name === 'updatePost').length, 0);
});
