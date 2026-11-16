import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { initializeRound } from '../server/round.js'
import { parseVideo } from '../shared/video.js'

const config = JSON.parse(fs.readFileSync('config/contest.json', 'utf8'))

test('new contest clears every old vote and result once while preserving accounts', () => {
  const db = { users: [{ id: 'voter' }], sessions: [{ userId: 'voter' }], devices: [{ registrations: 1 }], votes: [{ stage: 'selection' }, { stage: 'final', bonusFrom: 'student-03' }], semifinalists: ['student-03'], winners: ['student-05'], finalRoundId: 'old', adjustments: ['old'], recoveries: ['old'] }
  const before = structuredClone(db)
  assert.equal(initializeRound(db, config), true)
  assert.deepEqual(db.votes, [])
  assert.equal(db.semifinalists, null)
  assert.equal(db.winners, null)
  for (const key of ['users', 'sessions', 'devices']) assert.deepEqual(db[key], before[key])
  for (const key of ['finalRoundId', 'adjustments', 'recoveries']) assert.equal(key in db, false)
  db.votes.push({ userId: 'voter', studentId: config.students[0].id, stage: 'selection' })
  const restored = JSON.parse(JSON.stringify(db))
  assert.equal(initializeRound(restored, config), false)
  assert.deepEqual(restored, db)
})

test('all four replacement participants have supplied photos and playable video links', () => {
  assert.equal(config.students.length, 4)
  assert.equal(new Set(config.students.map(student => student.id)).size, 4)
  for (const student of config.students) {
    assert.doesNotMatch(student.name, /[?\uFFFD]/)
    assert.doesNotMatch(student.title, /[?\uFFFD]/)
    assert.notEqual(student.thumbnail, student.avatar)
    assert.ok(!fs.readFileSync(`public${student.thumbnail}`).equals(fs.readFileSync(`public${student.avatar}`)))
    assert.ok(parseVideo(student.video))
    assert.ok(fs.existsSync(`public${student.avatar}`))
    assert.ok(fs.existsSync(`public${student.thumbnail}`))
  }
})
