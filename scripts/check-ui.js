import { chromium } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import net from 'node:net'

fs.mkdirSync('test-results', { recursive: true })
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-vote-ui-'))
const reservation = net.createServer()
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve))
const port = reservation.address().port
await new Promise(resolve => reservation.close(resolve))
const server = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] })
await new Promise((resolve, reject) => { server.stdout.once('data', resolve); server.once('error', reject); server.once('exit', code => reject(new Error(`Server exited ${code}`))) })
let browser
try {
browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : {}) })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
page.on('requestfailed', request => { if (/tiktok|youtube/.test(request.url())) console.log('Video request failed:', request.url().slice(0, 150), request.failure()?.errorText) })
page.on('pageerror', error => { if (error.stack?.includes(`localhost:${port}`)) errors.push(error.message); else console.log('External player error:', error.message) })
await page.goto(`http://localhost:${port}`, { waitUntil: 'networkidle' })
await page.locator('.student-card').last().waitFor()
if (await page.locator('.student-card').count() !== 7) throw new Error('Expected 7 real students')
if ((await page.locator('.author h3').allTextContents())[0] !== 'Боярський Михайло') throw new Error('Wrong initial order')
if (await page.locator('.author img').count() !== 6) throw new Error('Expected 6 supplied photos')
await page.waitForFunction(() => [...document.querySelectorAll('.author img')].every(img => img.complete && img.naturalWidth > 0))
await page.locator('.student-card').last().scrollIntoViewIfNeeded()
await page.waitForFunction(() => [...document.querySelectorAll('.video-cover img')].length === 7 && [...document.querySelectorAll('.video-cover img')].every(img => img.complete && img.naturalWidth > 0))
await page.evaluate(() => scrollTo(0, 0))
await page.screenshot({ path: 'test-results/desktop.png', fullPage: true })
await page.getByRole('button', { name: 'Увійти', exact: false }).first().click()
await page.getByRole('dialog').waitFor()
await page.getByRole('button', { name: 'Реєстрація', exact: true }).click()
if (!await page.getByLabel('Ім’я та прізвище').isVisible()) throw new Error('Registration fields missing')
if (!await page.getByLabel('Email', { exact: true }).isVisible()) throw new Error('Email field missing')
await page.screenshot({ path: 'test-results/registration.png' })
await page.keyboard.press('Escape')
if (await page.getByRole('dialog').count()) throw new Error('Escape did not close modal')
await page.locator('.video-cover').first().click()
await page.locator('iframe[src*="youtube-nocookie.com"]').waitFor()
await page.getByRole('link', { name: 'Відкрити в YouTube' }).waitFor()
await page.keyboard.press('Escape')
for (let index = 0; index < 3; index++) {
  await page.locator('.video-cover.tiktok').nth(index).click()
  await page.locator('iframe[src*="tiktok.com/player/v1/"]').waitFor()
  await page.getByRole('link', { name: 'Відкрити в TikTok' }).waitFor()
  await page.waitForTimeout(8000)
  const playback = await Promise.all(page.frames().filter(frame => frame.url().includes('tiktok.com')).map(async frame => ({ url: frame.url(), text: (await frame.locator('body').innerText().catch(() => '')).slice(0, 600), video: await frame.locator('video').evaluateAll(videos => videos.map(video => ({ time: video.currentTime, paused: video.paused, readyState: video.readyState, error: video.error?.message }))) })))
  console.log('TikTok playback:', JSON.stringify(playback))
  if (process.env.VERIFY_PLAYBACK === '1' && !playback.some(frame => frame.video.some(video => video.time > 0 && video.readyState >= 2 && !video.error))) throw new Error(`TikTok ${index + 1} did not play`)
  await page.screenshot({ path: `test-results/tiktok-player-${index}.png` })
  await page.keyboard.press('Escape')
}
await page.setViewportSize({ width: 390, height: 844 })
await page.screenshot({ path: 'test-results/mobile.png', fullPage: true })
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
if (overflow) throw new Error('Mobile horizontal overflow')
await page.getByRole('button', { name: 'Правила голосування' }).click()
await page.getByRole('heading', { name: 'Як це працює' }).waitFor()
await page.screenshot({ path: 'test-results/mobile-rules.png' })
if (errors.length) throw new Error(errors.join('\n'))
console.log('Seven real students, six photos, alphabetic order, desktop/mobile, email registration, YouTube/TikTok iframe URLs and rules passed.')
} finally {
  await browser?.close()
  const exited = new Promise(resolve => server.once('exit', resolve))
  server.kill()
  await exited
  fs.rmSync(dataDir, { recursive: true, force: true })
}
