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

function contentFactoryService(env = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../../libraries/nestjs-libraries/src/database/prisma/posts/posts.service.ts'), 'utf8');
  const ast = ts.createSourceFile('posts.service.ts', source, ts.ScriptTarget.Latest, true);
  const service = ast.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'PostsService');
  const methods = service.members.filter(node => ts.isMethodDeclaration(node) && ['enrichPostMetadata', 'notifyContentFactory'].includes(node.name.getText(ast)));
  const code = ts.transpileModule(`class TestService { ${methods.map(node => node.getText(ast)).join('\n')} } exports.TestService = TestService;`, { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
  const calls = [];
  const axios = {
    get: async (...args) => { calls.push({ method: 'GET', args }); return { data: { title: 'A reviewed Content Factory title', hook: 'A reviewed description for the post', tags: ['test'] } }; },
    post: async (...args) => { calls.push({ method: 'POST', args }); return { status: 200 }; },
  };
  const exports = {};
  vm.runInNewContext(code, { exports, axios, process: { env }, URL, console: { log() {}, error() {} } });
  const instance = new exports.TestService();
  instance._postRepository = { updatePostSettings: async (...args) => calls.push({ method: 'persist', args }) };
  return { instance, calls };
}

test('Content Factory enrichment and callbacks authenticate against its actual service port', async () => {
  const key = 'unit-test-machine-key';
  const { instance, calls } = contentFactoryService({ CF_AUTOMATION_API_KEY: key });
  const post = { id: 'cf-post', settings: '{}', content: '', image: JSON.stringify([{ path: 'https://example.s3.amazonaws.com/run/video.mp4' }]) };
  await instance.enrichPostMetadata(post);
  await instance.notifyContentFactory(post.id, 'PUBLISHED', 'youtube', 'Test channel', 'https://example.test/live');
  const get = calls.find(call => call.method === 'GET');
  const callback = calls.find(call => call.method === 'POST');
  assert.equal(get.args[0], 'http://content-factory-api.aicart.svc.cluster.local:8001/api/media/run-metadata');
  assert.equal(get.args[1].headers['X-API-Key'], key);
  assert.equal(get.args[1].params.key, 'run/video.mp4');
  assert.equal(JSON.parse(post.settings).title, 'A reviewed Content Factory title');
  assert.equal(calls.filter(call => call.method === 'persist').length, 1);
  assert.equal(callback.args[0], 'http://content-factory-api.aicart.svc.cluster.local:8001/api/automation/publish-status');
  assert.equal(callback.args[2].headers['X-API-Key'], key);
  assert.equal(callback.args[1].release_url, 'https://example.test/live');
});

test('Content Factory callback honors an explicitly configured API URL', async () => {
  const { instance, calls } = contentFactoryService({ CF_API_URL: 'https://cf.example.test', CF_AUTOMATION_API_KEY: 'unit-test-machine-key' });
  await instance.notifyContentFactory('cf-post', 'ERROR', 'youtube', 'Test channel', undefined, 'Provider rejected media');
  assert.equal(calls[0].args[0], 'https://cf.example.test/api/automation/publish-status');
  assert.equal(calls[0].args[1].state, 'ERROR');
  assert.equal(calls[0].args[1].error, 'Provider rejected media');
});
