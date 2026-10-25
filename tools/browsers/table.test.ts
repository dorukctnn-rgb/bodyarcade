import { describe, expect, it } from 'vitest';
import { clean, messageOf, projectsOf, rowsOf, tableMarkdown, type JsonReport, type JsonTest } from './table.ts';

const test = (projectName: string, status: string, message = '', annotations: JsonTest['annotations'] = []): JsonTest => ({
  projectName, status, annotations, results: [{ status: status === 'expected' ? 'passed' : 'failed', duration: 1500, retry: 0, ...(message ? { error: { message } } : {}) }],
});

const report: JsonReport = {
  suites: [{
    title: 'flows.spec.ts', file: 'flows.spec.ts',
    suites: [{
      title: 'the practice build',
      specs: [
        { title: 'home: the tiles', ok: true, tests: [test('webkit-phone', 'expected'), test('firefox-desktop', 'expected'), test('webkit-desktop', 'expected')] },
        { title: 'camera: a round', ok: false, tests: [test('webkit-phone', 'unexpected', '\u001b[31mError:\u001b[0m waited 90 s for "countdown", the page was at "calibrating 2/4"\n\nCall log:\n  - waiting', [{ type: 'shot', description: 'qa-out/browsers/shots/webkit-phone/camera.jpg' }, { type: 'phases', description: 'explainer > calibrating 2/4' }]), test('firefox-desktop', 'skipped'), test('webkit-desktop', 'flaky', 'once')] },
      ],
    }],
  }],
};

describe('browser table', () => {
  it('strips colour codes and the call log from a message', () => {
    expect(clean('\u001b[31mred\u001b[0m')).toBe('red');
    expect(messageOf(test('p', 'unexpected', 'Error: first\nsecond\n\nCall log:\n  - x'))).toBe('Error: first | second');
  });

  it('makes one row per flow with a cell per project, and puts the pictures and phases on the failing one', () => {
    const rows = rowsOf(report);
    expect(rows.map((r) => r.flow)).toEqual(['the practice build > home: the tiles', 'the practice build > camera: a round']);
    const bad = rows[1]!.cells.find((c) => c.project === 'webkit-phone')!;
    expect(bad).toMatchObject({ outcome: 'FAIL', seconds: 1.5, shots: ['qa-out/browsers/shots/webkit-phone/camera.jpg'], notes: ['phases: explainer > calibrating 2/4'] });
    expect(bad.message).toContain('waited 90 s for "countdown"');
    expect(rows[1]!.cells.map((c) => c.outcome)).toEqual(['FAIL', 'skip', 'flaky']);
  });

  it('does not count a failure that is the limit of the test tool on an engine', () => {
    const rep: JsonReport = { suites: [{ title: 'x.spec.ts', file: 'x.spec.ts', specs: [{ title: 'plan', ok: false, tests: [test('firefox-ui', 'unexpected', 'browserContext.grantPermissions: Unknown permission: camera')] }] }] };
    const md = tableMarkdown(rowsOf(rep));
    expect(md).toContain('| plan | n/a |');
    expect(md).toContain('1 not applicable');
    expect(md).not.toContain('#### Failures');
  });

  it('orders the columns WebKit, Firefox, Chromium and phone before desktop, and writes the table and the failures', () => {
    const rows = rowsOf(report);
    expect(projectsOf(rows)).toEqual(['webkit-phone', 'webkit-desktop', 'firefox-desktop']);
    const md = tableMarkdown(rows);
    expect(md).toContain('| flow | webkit-phone | webkit-desktop | firefox-desktop |');
    expect(md).toContain('| the practice build > camera: a round | FAIL | flaky | skip |');
    expect(md).toContain('6 runs: 3 ok, 1 failed, 1 flaky, 1 skipped.');
    expect(md).toContain('- webkit-phone: the practice build > camera: a round');
    expect(md).toContain('pictures: qa-out/browsers/shots/webkit-phone/camera.jpg');
  });
});
