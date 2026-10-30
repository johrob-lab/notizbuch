import { expect, test } from 'vitest';
import { serialQueue } from '../../src/ui/serialQueue';

const later = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

test('tasks run one after the other in the order they were queued, even when an earlier one is slower', async () => {
  const run = serialQueue();
  const log: string[] = [];
  const first = run(async () => {
    log.push('first start');
    await later(20);
    log.push('first end');
    return 1;
  });
  const second = run(async () => {
    log.push('second start');
    return 2;
  });
  const third = run(async () => {
    log.push('third start');
    return 3;
  });
  expect(await Promise.all([first, second, third])).toEqual([1, 2, 3]);
  expect(log).toEqual(['first start', 'first end', 'second start', 'third start']);
});

test('a task that fails rejects only its own result, and the next task still runs', async () => {
  const run = serialQueue();
  const failing = run(async () => {
    throw new Error('kaputt');
  });
  const next = run(async () => 'weiter');
  await expect(failing).rejects.toThrow('kaputt');
  expect(await next).toBe('weiter');
});

test('a task that is queued later starts only after everything before it, also after a pause', async () => {
  const run = serialQueue();
  expect(await run(async () => 'a')).toBe('a');
  await later(5);
  const order: number[] = [];
  const slow = run(async () => {
    await later(10);
    order.push(1);
  });
  const fast = run(async () => void order.push(2));
  await Promise.all([slow, fast]);
  expect(order).toEqual([1, 2]);
});

test('two queues do not wait for each other', async () => {
  const one = serialQueue();
  const two = serialQueue();
  let release!: () => void;
  const blocked = one(() => new Promise<void>((resolve) => (release = resolve)));
  expect(await two(async () => 'frei')).toBe('frei');
  release();
  await blocked;
});
