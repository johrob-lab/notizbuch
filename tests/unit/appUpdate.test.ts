import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { CHECK_EVERY_MS, QUIET_MS, QUIET_POLL_MS, startAppUpdate, type AppUpdate, type UpdateEnv } from '../../src/lib/appUpdate';

// Die Umgebung ist ganz falsch: ein Service Worker mit auslösbarem Wechsel, Eingaben und Sichtbarkeit als EventTarget.

function setup(o: { controller?: boolean; noSw?: boolean } = {}) {
  const log: string[] = [];
  const input = new EventTarget();
  const visibility = new EventTarget();
  const worker = new EventTarget();
  const state = { editing: false, visible: 'visible', updates: 0, failBefore: false, controller: o.controller === false ? null : {} };
  const env: UpdateEnv = {
    sw: o.noSw
      ? undefined
      : {
          get controller() {
            return state.controller;
          },
          register: async () => ({
            update: async () => {
              state.updates++;
            },
          }),
          addEventListener: (_type, fn) => worker.addEventListener('controllerchange', fn),
        },
    target: { addEventListener: (type, fn) => input.addEventListener(type, fn) },
    doc: {
      get visibilityState() {
        return state.visible;
      },
      addEventListener: (_type, fn) => visibility.addEventListener('visibilitychange', fn),
    },
    editing: () => state.editing,
    reload: () => void log.push('reload'),
    beforeReload: async () => {
      log.push('before');
      if (state.failBefore) throw new Error('kaputt');
    },
    now: () => Date.now(),
  };
  const update: AppUpdate = startAppUpdate(env, '/notizbuch/sw.js', '/notizbuch/');
  const send = (type: string) => input.dispatchEvent(new Event(type));
  const changeController = () => worker.dispatchEvent(new Event('controllerchange'));
  const show = () => {
    state.visible = 'visible';
    visibility.dispatchEvent(new Event('visibilitychange'));
  };
  const hide = () => {
    state.visible = 'hidden';
    visibility.dispatchEvent(new Event('visibilitychange'));
  };
  return { log, state, update, send, changeController, show, hide };
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(() => vi.useRealTimers());

const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);

test('a new version is ready only after a controller change when there was a controller before', async () => {
  const a = setup();
  await tick(0);
  expect(a.update.ready).toBe(false);
  a.changeController();
  expect(a.update.ready).toBe(true);
  a.update.stop();

  const first = setup({ controller: false });
  await tick(0);
  first.changeController();
  expect(first.update.ready).toBe(false);
  await tick(QUIET_MS * 2);
  expect(first.log).toEqual([]);
  first.update.stop();
});

test('it reloads at once when the app comes to the front with a new version ready', async () => {
  const t = setup();
  await tick(0);
  t.send('keydown'); // eben noch getippt: nicht ruhig
  t.hide();
  t.changeController();
  await tick(QUIET_POLL_MS * 3);
  expect(t.log).toEqual([]);
  t.show();
  await tick(0);
  expect(t.log).toEqual(['before', 'reload']);
  t.update.stop();
});

test('it waits 60 seconds without input and never reloads while a pointer is down', async () => {
  const t = setup();
  await tick(0);
  t.send('pointerdown');
  t.changeController();
  await tick(120_000);
  expect(t.log).toEqual([]);
  t.send('pointerup');
  await tick(59_000);
  expect(t.log).toEqual([]);
  await tick(6_000);
  expect(t.log).toEqual(['before', 'reload']);
  await tick(QUIET_MS * 3);
  expect(t.log).toEqual(['before', 'reload']);
  t.update.stop();
});

test('it saves before reloading', async () => {
  const t = setup();
  await tick(0);
  t.changeController();
  await t.update.reloadNow();
  expect(t.log).toEqual(['before', 'reload']);
  t.update.stop();

  const bad = setup();
  bad.state.failBefore = true;
  await tick(0);
  await bad.update.reloadNow();
  expect(bad.log).toEqual(['before', 'reload']);
  bad.update.stop();
});

test('it looks for a new version every hour and when the app comes to the front', async () => {
  const t = setup();
  await tick(0);
  const start = t.state.updates;
  await tick(CHECK_EVERY_MS);
  expect(t.state.updates).toBe(start + 1);
  await tick(CHECK_EVERY_MS);
  expect(t.state.updates).toBe(start + 2);
  t.hide();
  await tick(0);
  expect(t.state.updates).toBe(start + 2);
  t.show();
  await tick(0);
  expect(t.state.updates).toBe(start + 3);
  t.update.stop();
});

test('without a service worker nothing happens and nothing throws', async () => {
  const t = setup({ noSw: true });
  await tick(CHECK_EVERY_MS * 2);
  await t.update.check();
  expect(t.update.ready).toBe(false);
  expect(t.log).toEqual([]);
  t.update.stop();
});

test('it never reloads while a text field has focus', async () => {
  const t = setup();
  await tick(0);
  t.state.editing = true;
  t.changeController();
  await tick(QUIET_MS * 3);
  expect(t.log).toEqual([]);
  t.state.editing = false;
  await tick(QUIET_POLL_MS);
  expect(t.log).toEqual(['before', 'reload']);
  t.update.stop();

  // Der Knopf Neu laden darf trotzdem.
  const b = setup();
  b.state.editing = true;
  await tick(0);
  await b.update.reloadNow();
  expect(b.log).toEqual(['before', 'reload']);
  b.update.stop();
});

test('scrolling with the wheel counts as input', async () => {
  const t = setup();
  await tick(0);
  t.send('keydown'); // erst nach einer Eingabe gilt die Pause von 60 s
  t.changeController();
  await tick(QUIET_MS - QUIET_POLL_MS);
  t.send('wheel');
  await tick(QUIET_MS - QUIET_POLL_MS);
  expect(t.log).toEqual([]);
  await tick(QUIET_POLL_MS * 2);
  expect(t.log).toEqual(['before', 'reload']);
  t.update.stop();
});

test('a pointer lost while hidden does not block the reload', async () => {
  const t = setup();
  await tick(0);
  t.send('pointerdown');
  t.hide();
  t.changeController();
  t.show();
  await tick(0);
  expect(t.log).toEqual(['before', 'reload']);
  t.update.stop();
});

test('a stopped instance no longer reacts', async () => {
  const t = setup();
  await tick(0);
  const start = t.state.updates;
  t.update.stop();
  t.changeController();
  expect(t.update.ready).toBe(false);
  t.show();
  await tick(CHECK_EVERY_MS * 2);
  expect(t.log).toEqual([]);
  expect(t.state.updates).toBe(start);
  await t.update.check();
  expect(t.state.updates).toBe(start);
});

test('without input since the start a new version loads at once', async () => {
  const t = setup();
  await tick(2_000);
  t.changeController();
  await tick(0);
  expect(t.log).toEqual(['before', 'reload']);
  t.update.stop();
});

test('without input since coming to the front a new version loads at once', async () => {
  const t = setup();
  await tick(0);
  t.send('pointerdown');
  t.send('pointerup');
  t.hide();
  await tick(1_000);
  t.show();
  await tick(3_000);
  t.changeController();
  await tick(0);
  expect(t.log).toEqual(['before', 'reload']);
  t.update.stop();
});

test('with input since the start it still waits 60 seconds', async () => {
  const t = setup();
  await tick(1_000);
  t.send('keydown');
  await tick(1_000);
  t.changeController();
  await tick(QUIET_MS - QUIET_POLL_MS);
  expect(t.log).toEqual([]);
  await tick(QUIET_POLL_MS * 2);
  expect(t.log).toEqual(['before', 'reload']);
  t.update.stop();
});

test('a quiet start still never reloads while a pointer is down or a text field has focus', async () => {
  const t = setup();
  await tick(2_000);
  t.state.editing = true;
  t.changeController();
  await tick(0);
  expect(t.log).toEqual([]);
  t.state.editing = false;
  t.send('pointerdown');
  // Länger als die 60 s Ruhe: Nur der Zeiger, der noch aufliegt, hält das Neuladen auf.
  await tick(QUIET_MS * 2);
  expect(t.log).toEqual([]);
  // Hebt er ab, zählt das als Eingabe: wieder 60 s Ruhe, dann lädt die App neu.
  t.send('pointerup');
  await tick(QUIET_MS - QUIET_POLL_MS);
  expect(t.log).toEqual([]);
  await tick(QUIET_POLL_MS * 2);
  expect(t.log).toEqual(['before', 'reload']);
  t.update.stop();
});

test('an input after coming to the front brings back the 60 seconds', async () => {
  const t = setup();
  await tick(0);
  t.hide();
  await tick(1_000);
  t.show();
  await tick(1_000);
  t.send('keydown');
  t.changeController();
  await tick(0);
  expect(t.log).toEqual([]);
  await tick(QUIET_MS - QUIET_POLL_MS);
  expect(t.log).toEqual([]);
  await tick(QUIET_POLL_MS * 2);
  expect(t.log).toEqual(['before', 'reload']);
  t.update.stop();
});

test('lifting, a cancelled pointer and the wheel each count as input', async () => {
  // Jede Eingabe allein, gleich nach dem Start: Ohne sie lüde die App die neue Version sofort, mit ihr wartet sie 60 s.
  for (const type of ['pointerup', 'pointercancel', 'wheel']) {
    const t = setup();
    await tick(1_000);
    t.send(type);
    t.changeController();
    await tick(0);
    expect(t.log, type).toEqual([]);
    await tick(QUIET_MS - QUIET_POLL_MS);
    expect(t.log, type).toEqual([]);
    await tick(QUIET_POLL_MS * 2);
    expect(t.log, type).toEqual(['before', 'reload']);
    t.update.stop();
  }
});
