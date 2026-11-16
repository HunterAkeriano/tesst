import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'

test('Zheliezniak vote adds a bonus only to Mamai once and survives restart', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-vote-bonus-'))
  const config = JSON.parse(fs.readFileSync('tests/fixtures/previous-contest.json', 'utf8'))
  config.deadline = new Date(Date.now() - 2000).toISOString()
  config.final.startsAt = new Date(Date.now() - 1000).toISOString()
  config.final.deadline = new Date(Date.now() + 3600000).toISOString()
  const configPath = path.join(directory, 'contest.json')
  fs.writeFileSync(configPath, JSON.stringify(config))
  fs.writeFileSync(path.join(directory, 'votes.json'), JSON.stringify({
    users: [{ id: 'voter', name: 'Test' }, { id: 'other', name: 'Other' }],
    sessions: ['voter', 'other'].map(id => ({ userId: id, token: createHash('sha256').update(id).digest('hex'), expires: Date.now() + 3600000 })),
    votes: [], semifinalists: config.final.participantIds, winners: null, finalRoundId: config.final.roundId
  }))
  const reservation = net.createServer()
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve))
  const port = reservation.address().port
  await new Promise(resolve => reservation.close(resolve))
  let server
  async function start() {
    server = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, TRUST_PROXY: '1', NODE_ENV: 'test', DATA_DIR: directory, CONFIG_PATH: configPath, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] })
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
  const contest = () => fetch(`http://127.0.0.1:${port}/api/contest`, { headers: { Cookie: 'session=voter' } }).then(response => response.json())
  const vote = (studentId, session = 'voter', ip = '192.0.2.1') => fetch(`http://127.0.0.1:${port}/api/vote`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'AI-Vote', 'X-Forwarded-For': ip, Cookie: `session=${session}` }, body: JSON.stringify({ studentId }) })
  const counts = result => Object.fromEntries(result.students.map(student => [student.id, student.votes]))
  try {
    await start()
    const before = counts(await contest())
    const responses = await Promise.all([vote('student-03'), vote('student-03')])
    assert.deepEqual(responses.map(response => response.status).sort(), [200, 409])
    const after = await contest()
    for (const id of ['student-03', 'student-05']) assert.equal(counts(after)[id], before[id] + 1)
    assert.equal(before['student-06'], 135)
    assert.equal(before['student-05'], 150)
    assert.equal(counts(after)['student-06'], before['student-06'])
    assert.equal(after.myVote, 'student-03')
    const stored = JSON.parse(fs.readFileSync(path.join(directory, 'votes.json'), 'utf8'))
    assert.deepEqual(stored.votes.filter(entry => entry.bonusFrom === 'student-03').map(entry => entry.studentId), ['student-05'])
    await stop()
    await start()
    assert.deepEqual(counts(await contest()), counts(after))
    assert.equal((await vote('student-03')).status, 409)
    const blocked = await vote('student-05', 'other', '::ffff:192.0.2.1')
    assert.equal(blocked.status, 409)
    assert.equal((await blocked.json()).code, 'IP_ALREADY_VOTED')
    assert.deepEqual(counts(await contest()), counts(after))
    assert.equal((await vote('student-05', 'other', '192.0.2.2')).status, 200)
    const direct = counts(await contest())
    assert.equal(direct['student-05'], counts(after)['student-05'] + 1)
    assert.equal(direct['student-06'], counts(after)['student-06'])
    assert.equal(direct['student-03'], counts(after)['student-03'])
  } finally {
    await stop()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
