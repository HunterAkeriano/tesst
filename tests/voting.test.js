import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'

test('registration, concurrent votes, persistence, cutoff and second round', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-vote-test-'))
  const configPath = path.join(directory, 'contest.json')
  const config = JSON.parse(fs.readFileSync('config/contest.json', 'utf8'))
  config.deadline = new Date(Date.now() + 3600000).toISOString()
  config.students.forEach((student, index) => { student.id = String(index + 1).padStart(2, '0'); student.video = 'aqz-KE-bpKQ' })
  fs.writeFileSync(configPath, JSON.stringify(config))
  const reservation = net.createServer()
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve))
  const port = reservation.address().port
  await new Promise(resolve => reservation.close(resolve))
  const env = { ...process.env, NODE_ENV: 'test', DATA_DIR: directory, CONFIG_PATH: configPath, PORT: String(port) }
  let server
  let deviceCookie
  async function start() {
    server = spawn(process.execPath, ['server/index.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    await new Promise((resolve, reject) => {
      server.stdout.once('data', resolve)
      server.once('exit', code => reject(new Error(`Server exited ${code}`)))
      server.once('error', reject)
    })
  }
  async function stop() {
    if (!server || server.exitCode !== null) return
    const exited = new Promise(resolve => server.once('exit', resolve))
    server.kill()
    await exited
  }
  async function request(route, body, cookie, headers = true) {
    const combined = [deviceCookie, cookie].filter(Boolean).join('; ')
    const response = await fetch(`http://127.0.0.1:${port}/api/${route}`, { method: body ? 'POST' : 'GET', headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(headers ? { 'X-Requested-With': 'AI-Vote' } : {}), ...(combined ? { Cookie: combined } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
    const deviceHeader = response.headers.getSetCookie().find(value => value.startsWith('device='))
    if (deviceHeader) deviceCookie = deviceHeader.split(';')[0]
    return { status: response.status, cookie: response.headers.get('set-cookie')?.split(';')[0], body: await response.json() }
  }
  try {
    await start()
    assert.equal((await request('register', { name: 'Тест', email: 'nocookie@example.com', password: 'password123' })).status, 403)
    const initial = await request('contest')
    assert.equal(initial.body.students.length, config.students.length)
    assert.deepEqual(initial.body.students.map(s => s.name), config.students.map(s => s.name).sort((a, b) => a.localeCompare(b, 'uk')))
    assert.equal((await request('vote', { studentId: '01' })).status, 401)
    assert.equal((await request('register', { name: 'Тест', email: 'voter@example.com', password: 'password123' }, null, false)).status, 403)
    assert.equal((await request('register', { name: 'Тест', email: 'INVALID', password: 'password123' })).status, 400)
    const registrations = await Promise.all(Array.from({ length: 3 }, () => request('register', { name: 'Тест', email: 'voter@example.com', password: 'password123' })))
    assert.equal(registrations.filter(r => r.status === 200).length, 1)
    let cookie = registrations.find(r => r.status === 200).cookie
    const votes = await Promise.all(Array.from({ length: 4 }, () => request('vote', { studentId: '01' }, cookie)))
    assert.equal(votes.filter(r => r.status === 200).length, 1)
    assert.equal((await request('contest', undefined, cookie)).body.myVote, '01')
    assert.equal((await request('contest')).body.totalVoters, 1)
    assert.equal((await request('login', { email: 'voter@example.com', password: 'wrong-password' })).status, 401)
    await request('logout', {}, cookie)
    assert.equal((await request('vote', { studentId: '02' }, cookie)).status, 401)
    const login = await request('login', { email: 'VOTER@EXAMPLE.COM', password: 'password123' })
    cookie = login.cookie
    assert.equal((await request('vote', { studentId: '02' }, cookie)).status, 409)
    await stop()
    await start()
    assert.equal((await request('contest', undefined, cookie)).body.myVote, '01')
    const additional = await Promise.all(['second', 'third', 'fourth'].map(name => request('register', { name, email: `${name}@example.com`, password: 'password123' })))
    assert.equal(additional.filter(r => r.status === 200).length, 1)
    assert.equal(additional.filter(r => r.status === 403).length, 2)
    await stop()
    await start()
    assert.equal((await request('register', { name: 'Fifth', email: 'fifth@example.com', password: 'password123' })).status, 403)
    await stop()
    config.deadline = new Date(Date.now() - 1000).toISOString()
    fs.writeFileSync(configPath, JSON.stringify(config))
    await start()
    const results = await request('contest')
    assert.equal(results.body.phase, 'results')
    assert.deepEqual(results.body.semifinalists, ['01', '02', '03'])
    assert.equal((await request('vote', { studentId: '02' }, cookie)).status, 409)
    await stop()
    config.final = { enabled: true, startsAt: new Date(Date.now() - 500).toISOString(), deadline: new Date(Date.now() + 3600000).toISOString() }
    fs.writeFileSync(configPath, JSON.stringify(config))
    await start()
    assert.equal((await request('contest')).body.phase, 'final')
    assert.equal((await request('contest')).body.totalVoters, 0)
    assert.equal((await request('vote', { studentId: '04' }, cookie)).status, 400)
    assert.equal((await request('vote', { studentId: '02' }, cookie)).status, 200)
    assert.equal((await request('contest')).body.students[0].id, '02')
    assert.equal((await request('vote', { studentId: '03' }, cookie)).status, 409)
    await stop()
    config.final.deadline = new Date(Date.now() - 1).toISOString()
    fs.writeFileSync(configPath, JSON.stringify(config))
    await start()
    const finished = await request('contest')
    assert.equal(finished.body.phase, 'finished')
    assert.equal(finished.body.winners[0], '02')
    assert.equal((await request('vote', { studentId: '03' }, cookie)).status, 409)
  } finally { await stop(); fs.rmSync(directory, { recursive: true, force: true }) }
})
