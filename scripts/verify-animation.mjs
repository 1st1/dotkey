#!/usr/bin/env node
/**
 * Animation verification.
 *
 * Wall-clock playback is not a reliable thing to assert on: a headless browser
 * produces no frames at all, and a headed window that loses focus is throttled
 * to none either. So instead of watching animations run, this drives them —
 * every animation is paused and seeked to a fixed progress, which applies the
 * interpolated value synchronously. That checks the thing that can actually be
 * wrong (the keyframes and the settled state) and is deterministic everywhere.
 *
 *   pnpm dev            # in one terminal
 *   node scripts/verify-animation.mjs
 */
// @lat: [[tests#Browser verification#Drives build and transition playback]]
import { execFileSync } from 'node:child_process';

const BASE = process.env.KEYNOTE_DEMO_URL ?? 'http://localhost:5273';
const SESSION = 'kn-anim';

function ab(args, stdin) {
  return execFileSync('agent-browser', ['--session', SESSION, ...args], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    ...(stdin === undefined ? {} : { input: stdin }),
  });
}

/** Run an expression in the page and parse the JSON it returns. */
function evaluate(expression) {
  const raw = ab(['eval', '--stdin'], expression);
  const text = raw.trim().replace(/^﻿/, '');
  // `agent-browser eval` prints the result as a JSON string literal.
  const outer = text.startsWith('"') ? JSON.parse(text) : text;
  return JSON.parse(outer);
}

function open(url) {
  ab(['open', url]);
  ab(['wait', '--fn', 'window.keynote && document.fonts.status === "loaded"']);
  ab(['wait', '150']);
}

const SEEK = `
// React commits asynchronously, so every interaction has to be followed by a
// yield before the resulting animations exist to be seeked.
const tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
const seek = (fraction) => {
  for (const animation of document.getAnimations()) {
    const timing = animation.effect.getTiming();
    const total = Number(timing.delay ?? 0) + Number(timing.duration ?? 0);
    animation.pause();
    animation.currentTime = total * fraction;
  }
};
const read = (ids) => ids.map((id) => {
  const node = document.querySelector('[data-keynote-id="' + id + '"]');
  if (!node) return { id, missing: true };
  const style = getComputedStyle(node);
  const box = node.getBoundingClientRect();
  return {
    id,
    hidden: style.visibility === 'hidden',
    opacity: Number(Number(style.opacity).toFixed(2)),
    x: Number(box.x.toFixed(1)),
    y: Number(box.y.toFixed(1)),
  };
});
const press = async (key) => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  await tick();
};
const currentSlide = () =>
  Number(document.querySelector('[data-keynote-slide]')?.dataset.keynoteSlide ?? -1);
`;

const checks = [];
function check(name, condition, detail) {
  checks.push({ name, ok: Boolean(condition), detail });
  const mark = condition ? '[32m✓[0m' : '[31m✗[0m';
  console.log(`  ${mark} ${name}${condition ? '' : `\n      ${JSON.stringify(detail)}`}`);
}

ab(['set', 'viewport', '1920', '1080']);

// ---------------------------------------------------------------------------
console.log('\nSlide 0 — action builds (motion path + opacity)');
open(`${BASE}/?bare=0&animate=1`);

const slide0 = evaluate(`(async () => {
  ${SEEK}
  const ids = ['4155089', '4155229'];
  const out = { stageCount: window.keynote.deck.slides[0].stageCount, at: {} };
  out.at['stage0'] = read(ids);
  await press('ArrowRight');
  out.animations = document.getAnimations().length;
  seek(0);    out.at['0%'] = read(ids);
  seek(0.5);  out.at['50%'] = read(ids);
  seek(1);    out.at['100%'] = read(ids);
  for (const a of document.getAnimations()) a.cancel();
  out.at['settled'] = read(ids);
  return JSON.stringify(out);
})()`);

const at = (label, id) => slide0.at[label].find((entry) => entry.id === id);

check('one click stage', slide0.stageCount === 1, slide0.stageCount);
check('the click starts three animations', slide0.animations === 3, slide0.animations);
check(
  'both groups start in place, fully opaque',
  at('stage0', '4155089').x === 462.8 && at('stage0', '4155229').opacity === 1,
  slide0.at['stage0'],
);
check(
  'motion path starts at the original position',
  Math.abs(at('0%', '4155089').x - 462.8) < 1,
  at('0%', '4155089'),
);
check(
  'motion path is halfway across at 50%',
  Math.abs(at('50%', '4155089').x - (462.8 + 270.66 / 2)) < 2,
  at('50%', '4155089'),
);
check(
  'motion path ends 270.7pt to the right',
  Math.abs(at('100%', '4155089').x - (462.8 + 270.66)) < 1,
  at('100%', '4155089'),
);
check(
  'second group travels 263.9pt to the left',
  Math.abs(at('100%', '4155229').x - (1012.7 - 263.89)) < 1,
  at('100%', '4155229'),
);
check(
  'opacity action fades the second group out',
  at('100%', '4155229').opacity === 0,
  at('100%', '4155229'),
);
check(
  'settled state survives cancelling the animations',
  Math.abs(at('settled', '4155089').x - (462.8 + 270.66)) < 1 &&
    at('settled', '4155229').opacity === 0,
  slide0.at['settled'],
);

// ---------------------------------------------------------------------------
console.log('\nSlide 7 — seven build-in stages (dissolve)');
open(`${BASE}/?bare=7&animate=1`);

const slide7 = evaluate(`(async () => {
  ${SEEK}
  const ids = window.keynote.deck.slides[7].builds.map((b) => b.elementId);
  const out = { ids, stageCount: window.keynote.deck.slides[7].stageCount, at: {} };
  out.at['stage0'] = read(ids);
  await press('ArrowRight');
  seek(0);   out.at['stage1 0%'] = read(ids);
  seek(0.5); out.at['stage1 50%'] = read(ids);
  seek(1);   out.at['stage1 100%'] = read(ids);
  for (const a of document.getAnimations()) a.cancel();
  await press('ArrowRight');
  for (const a of document.getAnimations()) a.cancel();
  out.at['stage2'] = read(ids);
  await press('ArrowLeft');
  out.at['back to stage1'] = read(ids);
  return JSON.stringify(out);
})()`);

const first = slide7.ids[0];
const second = slide7.ids[1];
const pick = (label, id) => slide7.at[label].find((entry) => entry.id === id);

check('seven click stages', slide7.stageCount === 7, slide7.stageCount);
check(
  'every build-in element is hidden at stage 0',
  slide7.at['stage0'].every((entry) => entry.hidden),
  slide7.at['stage0'],
);
check(
  'the first element is revealed at stage 1, still transparent at 0%',
  !pick('stage1 0%', first).hidden && pick('stage1 0%', first).opacity === 0,
  pick('stage1 0%', first),
);
check(
  'it is partly faded in at 50%',
  pick('stage1 50%', first).opacity > 0.2 && pick('stage1 50%', first).opacity < 0.9,
  pick('stage1 50%', first),
);
check(
  'it is fully opaque at 100%',
  pick('stage1 100%', first).opacity === 1,
  pick('stage1 100%', first),
);
check(
  'later elements stay hidden',
  pick('stage1 100%', second).hidden,
  pick('stage1 100%', second),
);
check(
  'stage 2 reveals exactly one more element',
  slide7.at['stage2'].filter((entry) => !entry.hidden).length === 2,
  slide7.at['stage2'],
);
check(
  'stepping back hides it again, without animating',
  slide7.at['back to stage1'].filter((entry) => !entry.hidden).length === 1 &&
    pick('back to stage1', first).opacity === 1,
  slide7.at['back to stage1'],
);

// ---------------------------------------------------------------------------
console.log('\nSlide 5 — a movie that starts automatically (stage 0)');
open(`${BASE}/?bare=5&animate=1`);

const slide5 = evaluate(`(() => {
  const slide = window.keynote.deck.slides[5];
  return JSON.stringify({
    stageCount: slide.stageCount,
    builds: slide.builds.map((b) => ({ stage: b.stage, type: b.animation.type, trigger: b.trigger })),
  });
})()`);

check('no clicks needed', slide5.stageCount === 0, slide5.stageCount);
check(
  'the media build runs on slide entry',
  slide5.builds.length === 1 &&
    slide5.builds[0].stage === 0 &&
    slide5.builds[0].type === 'media' &&
    slide5.builds[0].trigger === 'automatic',
  slide5.builds,
);

// ---------------------------------------------------------------------------
console.log('\nSlide 4 — a 1.5s dissolve transition');
open(`${BASE}/`);

const transition = evaluate(`(async () => {
  ${SEEK}
  const buttons = [...document.querySelectorAll('button')];
  // The header arrows are playback-aware, so reaching a slide means clicking
  // through every build on the way.
  const goTo = async (index) => {
    for (let guard = 0; guard < 80 && currentSlide() !== index; guard++) {
      buttons[currentSlide() < index ? 1 : 0].click();
      await tick();
    }
  };
  const layers = () => [...document.querySelectorAll('[data-keynote-slide]')].map((node) => ({
    slide: Number(node.dataset.keynoteSlide),
    opacity: Number(Number(getComputedStyle(node.parentElement).opacity).toFixed(2)),
  }));

  await goTo(3);
  // Play slide 3 out, so the next click is the one that changes slides.
  for (let i = 0; i < window.keynote.deck.slides[3].stageCount; i++) {
    await press('ArrowRight');
  }
  const out = { transition: window.keynote.deck.slides[4].transition, from: currentSlide(), at: {} };
  buttons[1].click();
  await tick();
  seek(0);    out.at['0%'] = layers();
  seek(0.5);  out.at['50%'] = layers();
  seek(1);    out.at['100%'] = layers();
  return JSON.stringify(out);
})()`);

check(
  'the transition is read as a dissolve',
  transition.transition?.kind === 'dissolve' && transition.transition.duration === 1.5,
  transition.transition,
);
check(
  'both slides are mounted during the transition',
  transition.at['0%'].length === 2,
  transition.at['0%'],
);
check(
  'the incoming slide starts invisible and the outgoing one opaque',
  transition.at['0%'].find((l) => l.slide === 4)?.opacity === 0 &&
    transition.at['0%'].find((l) => l.slide === 3)?.opacity === 1,
  transition.at['0%'],
);
check(
  'they cross-fade at the midpoint',
  (transition.at['50%'].find((l) => l.slide === 4)?.opacity ?? 0) > 0.3 &&
    (transition.at['50%'].find((l) => l.slide === 3)?.opacity ?? 1) < 0.7,
  transition.at['50%'],
);
check(
  'the incoming slide is fully visible at the end',
  transition.at['100%'].find((l) => l.slide === 4)?.opacity === 1 &&
    transition.at['100%'].find((l) => l.slide === 3)?.opacity === 0,
  transition.at['100%'],
);

// ---------------------------------------------------------------------------
console.log('\nRegressions');

// A freshly loaded deck must play slide 0's builds before moving on. This is
// the workbench path, with a parent component subscribed to stage changes —
// exactly the pending-work situation in which React skips the eager evaluation
// of a setState updater, which is what `next()` used to read its result from.
open(`${BASE}/`);
const firstPress = evaluate(`(async () => {
  ${SEEK}
  const before = { slide: currentSlide(), stage: window.keynote.deck.slides[0].stageCount };
  await press('ArrowRight');
  return JSON.stringify({
    before,
    slide: currentSlide(),
    animations: document.getAnimations().length,
    header: document.querySelector('header').innerText.replace(/\\s+/g, ' '),
  });
})()`);

check(
  'the first click on a freshly loaded deck stays on slide 0',
  firstPress.slide === 0,
  firstPress,
);
check(
  'and plays its three action builds instead of skipping the slide',
  firstPress.animations === 3 && / build 1 \/ 1 /.test(` ${firstPress.header} `),
  firstPress,
);

// @lat: [[tests#Browser verification#Keeps a new slide's builds hidden on the first paint]]
// Entering a slide used to paint one frame with the *previous* slide's stage,
// so every build-in element flashed fully built before snapping to stage 0.
open(`${BASE}/`);
const flash = evaluate(`(async () => {
  ${SEEK}
  const buttons = [...document.querySelectorAll('button')];
  const goTo = async (index) => {
    for (let guard = 0; guard < 40 && currentSlide() !== index; guard++) {
      buttons[currentSlide() < index ? 1 : 0].click();
      await tick();
    }
  };

  await goTo(7);
  // Build slide 7 all the way out, so the outgoing stage is as high as it gets.
  for (let i = 0; i < 7; i++) await press('ArrowRight');
  const builtStage = window.keynote.deck.slides[7].stageCount;

  const records = [];
  const observer = new MutationObserver((list) => {
    for (const record of list) {
      const node = record.target;
      if (!node.dataset || node.dataset.keynoteId === undefined) continue;
      const wasHidden = /visibility:\s*hidden/.test(record.oldValue ?? '');
      const isHidden = getComputedStyle(node).visibility === 'hidden';
      if (!wasHidden && isHidden) records.push(node.dataset.keynoteId);
    }
  });
  observer.observe(document.body, {
    attributes: true, attributeFilter: ['style'], attributeOldValue: true, subtree: true,
  });

  // Builds are exhausted, so this moves to slide 8 — seven build-ins.
  await press('ArrowRight');
  await tick(120);
  observer.disconnect();

  const ids = window.keynote.deck.slides[8].builds.map((b) => b.elementId);
  return JSON.stringify({
    builtStage,
    slide: currentSlide(),
    hiddenNow: ids.filter((id) => {
      const node = document.querySelector('[data-keynote-id="' + id + '"]');
      return node && getComputedStyle(node).visibility === 'hidden';
    }).length,
    total: ids.length,
    flashed: [...new Set(records)],
  });
})()`);

check('the exhausted slide hands over to the next one', flash.slide === 8, flash);
check(
  'every build-in on the new slide is hidden from the first paint',
  flash.hiddenNow === flash.total && flash.total === 7,
  flash,
);
check(
  'no element is painted visible and then hidden',
  flash.flashed.length === 0,
  flash.flashed,
);

// ---------------------------------------------------------------------------
const failed = checks.filter((entry) => !entry.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
