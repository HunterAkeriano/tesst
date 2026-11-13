import { chromium } from '@playwright/test'
import express from 'express'
import fs from 'node:fs'
import assert from 'node:assert/strict'

const config = JSON.parse(fs.readFileSync('config/contest.json', 'utf8'))
const app = express()
app.use(express.static('dist'))
const server = app.listen(0, '127.0.0.1')
await new Promise(resolve => server.once('listening', resolve))
let browser
try {
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : {}) })
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport })
    await page.route('**/api/contest', route => route.fulfill({ json: { title: config.title, phase: 'final', serverTime: Date.now(), deadline: new Date(Date.now() + 3600000).toISOString(), students: config.students.map(student => ({ ...student, votes: 0 })), semifinalists: config.final.participantIds, winners: null, user: { name: 'Test' }, myVote: null, totalVoters: 0 } }))
    await page.route('**/api/vote', route => route.fulfill({ status: 409, json: { code: 'IP_ALREADY_VOTED', error: 'З цієї IP-адреси вже проголосували на цьому етапі. Повторне голосування з цієї мережі недоступне.' } }))
    await page.goto(`http://127.0.0.1:${server.address().port}`)
    await page.locator('.vote-button').first().click()
    await page.getByRole('button', { name: 'Так, проголосувати ↗' }).click()
    const dialog = page.getByRole('alertdialog')
    await dialog.waitFor()
    const bounds = await dialog.boundingBox()
    assert.ok(bounds.width >= viewport.width * 0.8)
    assert.ok(bounds.height >= viewport.height * 0.8)
    assert.ok(bounds.x >= 0 && bounds.y >= 0)
    assert.ok(bounds.x + bounds.width <= viewport.width)
    assert.ok(bounds.y + bounds.height <= viewport.height)
    await page.getByRole('button', { name: 'Зрозуміло' }).click()
    assert.equal(await dialog.count(), 0)
    await page.close()
  }
  console.log('IP error dialog passed desktop and mobile checks')
} finally {
  await browser?.close()
  server.close()
}
