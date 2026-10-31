import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startE2eGitHub } from '../fakes/github.mjs';

const TOKEN = 'e2e-token';
const BASE_SHA = 'a1'.repeat(20);
const HEADERS = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };

test('the e2e GitHub proxy reports the seed commit as every pull request base', async () => {
  const github = await startE2eGitHub({
    token: TOKEN,
    owner: 'acme',
    repo: 'widgets',
    defaultBranch: 'main',
    baseSha: BASE_SHA,
  });
  try {
    const created = await fetch(`${github.url}/repos/acme/widgets/pulls`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ title: 'the e2e change', head: 'cb/run_1-change', base: 'main' }),
    });
    assert.equal(created.status, 201);
    const pullRequest = await created.json();
    assert.equal(pullRequest.number, 1);
    assert.equal(pullRequest.base.sha, BASE_SHA);
    assert.equal(pullRequest.base.ref, 'main');
    assert.equal(pullRequest.head.sha, '0'.repeat(39) + '1');
    assert.match(pullRequest.html_url, /^https:\/\/github\.com\/acme\/widgets\/pull\/1$/);

    const fetched = await fetch(`${github.url}/repos/acme/widgets/pulls/1`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(fetched.status, 200);
    assert.equal((await fetched.json()).base.sha, BASE_SHA);

    const listed = await fetch(
      `${github.url}/repos/acme/widgets/pulls?head=acme%3Acb%2Frun_1-change&state=open`,
      { headers: { authorization: `Bearer ${TOKEN}` } },
    );
    assert.equal(listed.status, 200);
    const page = await listed.json();
    assert.equal(page.length, 1);
    assert.equal(page[0].base.sha, BASE_SHA);

    const merged = await fetch(`${github.url}/repos/acme/widgets/pulls/1/merge`, {
      method: 'PUT',
      headers: HEADERS,
      body: JSON.stringify({ merge_method: 'squash' }),
    });
    assert.equal(merged.status, 200);
    assert.equal((await merged.json()).merged, true);

    const refused = await fetch(`${github.url}/repos/acme/widgets/pulls/1`);
    assert.equal(refused.status, 401, 'the proxy must forward the Authorization header');

    assert.ok(
      github.requests.some(
        (entry) => entry.method === 'POST' && entry.path === '/repos/acme/widgets/pulls',
      ),
      'the upstream fake did not record the pull request',
    );
    assert.ok(
      github.requests.some(
        (entry) =>
          entry.method === 'POST' &&
          entry.path === '/repos/acme/widgets/pulls' &&
          entry.authorization === `Bearer ${TOKEN}`,
      ),
    );
  } finally {
    await github.close();
  }
});
