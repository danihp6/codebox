import { describe, expect, it } from 'vitest';
import { decideVerdict } from './verdict.mjs';

const base = { gateOk: true, agentOk: true, moved: true, issued: false, merge: true };

describe('decideVerdict', () => {
  it('is red when the merged tree does not pass the gate, whatever else happened', () => {
    expect(decideVerdict({ ...base, gateOk: false })).toMatchObject({
      ok: false,
      status: 'failed',
    });
    expect(
      decideVerdict({ ...base, gateOk: false, moved: false, issued: false, agentOk: false }).ok,
    ).toBe(false);
  });

  it('is green when main moved, and stays green when the stream died after shipping', () => {
    expect(decideVerdict(base)).toMatchObject({ ok: true, status: 'shipped' });
    expect(decideVerdict({ ...base, agentOk: false })).toMatchObject({
      ok: true,
      status: 'resumed',
    });
  });

  it('counts an opened issue as a trace, because a blocked cycle is not a silent one', () => {
    expect(decideVerdict({ ...base, moved: false, issued: true })).toMatchObject({
      ok: true,
      status: 'shipped',
    });
  });

  it('is green when it stopped after QA on purpose', () => {
    expect(
      decideVerdict({ ...base, merge: false, moved: false, issued: false }),
    ).toMatchObject({ ok: true, status: 'stopped' });
  });

  it('is red when nothing moved, nothing was opened and it did not finish', () => {
    expect(
      decideVerdict({ ...base, moved: false, issued: false, agentOk: false }),
    ).toMatchObject({ ok: false, status: 'failed' });
    expect(decideVerdict({ ...base, moved: false, issued: false })).toMatchObject({
      ok: false,
      status: 'failed',
    });
  });
});
