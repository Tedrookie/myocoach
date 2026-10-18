import { chromium } from 'playwright-core';
import { readFile } from 'node:fs/promises';

const origin = process.env.APP_URL ?? 'http://127.0.0.1:5174';
const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

try {
  const context = await browser.newContext();
  const workout = await context.newPage();
  const g2 = await context.newPage();
  const errors = [];
  workout.on('pageerror', (error) => errors.push(`workout: ${error.message}`));
  g2.on('pageerror', (error) => errors.push(`G2: ${error.message}`));

  await workout.goto(origin);
  await workout.waitForFunction(() => !!window.__link);
  const code = await workout.evaluate(() => window.__link.code);
  await g2.goto(`${origin}/g2.html`);
  await g2.locator('#server').fill(origin);
  await g2.locator('#code').fill(code);
  await g2.getByRole('button', { name: 'Connect' }).click();
  await g2.locator('#status').getByText('Workout linked', { exact: false }).waitFor();

  await workout.getByText('Start training').click();
  await workout.getByLabel('Target sets').fill('2');
  await workout.getByLabel('Target reps').fill('1');
  await workout.getByLabel('Rest seconds').fill('5');
  await workout.evaluate(() => document.activeElement?.blur());
  await workout.waitForFunction(() => window.__engine.getSnapshot().effort < 0.1);
  await workout.keyboard.down('Space');
  await g2.waitForFunction(() => document.querySelector('#preview')?.textContent?.includes('ACTIVE'));
  await workout.waitForTimeout(1100);
  await workout.keyboard.up('Space');
  await workout.waitForFunction(() => window.__engine.getSnapshot().reps >= 1);
  await workout.keyboard.press('Enter');
  await g2.waitForFunction(() => document.querySelector('#preview')?.textContent?.includes('REST'));
  const saved = await workout.evaluate(() => JSON.parse(localStorage.getItem('emgcoach.sets.v1') ?? '[]'));
  if (saved.length !== 1 || saved[0].reps < 1 || saved[0].restTargetS !== 5) {
    throw new Error(`Unexpected saved set: ${JSON.stringify(saved)}`);
  }

  await workout.waitForFunction(() => window.__engine.getSnapshot().effort < 0.1);
  await workout.keyboard.down('Space');
  await workout.waitForTimeout(1100);
  await workout.keyboard.up('Space');
  await workout.waitForFunction(() => window.__engine.getSnapshot().reps >= 1);
  await workout.keyboard.press('Enter');
  await workout.waitForFunction(() => !window.__engine.getSnapshot().inSet);
  const twoSets = await workout.evaluate(() => JSON.parse(localStorage.getItem('emgcoach.sets.v1') ?? '[]'));
  if (twoSets.length !== 2 || twoSets[1].restBeforeS <= 0) {
    throw new Error(`Rest interval was not recorded: ${JSON.stringify(twoSets)}`);
  }

  await workout.evaluate(() => window.__engine.finish());
  const downloadPromise = workout.waitForEvent('download');
  await workout.getByRole('button', { name: 'Export set data' }).click();
  const download = await downloadPromise;
  const exported = JSON.parse(await readFile(await download.path(), 'utf8'));
  if (exported.schema !== 'myocoach.workout.v1' || exported.sets.length !== 2) {
    throw new Error('Workout JSON export did not contain both set records.');
  }
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('G2 smoke passed: pairing, rep and rest countdowns, actual rest interval, two saved sets, JSON export.');
} finally {
  await browser.close();
}
