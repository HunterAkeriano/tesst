import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { initializeFinal } from '../server/final.js'
import { rank } from '../server/store.js'

const config = JSON.parse(fs.readFileSync('config/contest.json', 'utf8'))

test('final resets once, fixes finalists and preserves accounts and selection history', () => {
  const selectionVote = { userId: 'voter', studentId: 'student-03', stage: 'selection' }
  const db = { users: [{ id: 'voter' }], sessions: [{ userId: 'voter' }], votes: [selectionVote, { userId: 'voter', studentId: 'student-05', stage: 'final' }], semifinalists: ['student-01'], winners: ['student-01'] }
  assert.equal(initializeFinal(db, config), true)
  assert.deepEqual(db.semifinalists, ['student-03', 'student-05', 'student-06'])
  assert.deepEqual(db.votes, [selectionVote])
  assert.equal(db.users[0].id, 'voter')
  assert.equal(db.sessions[0].userId, 'voter')
  assert.equal(db.winners, null)
  assert.deepEqual(rank(config.students, db.votes, 'final').map(student => student.votes), [0, 0, 0])
  db.votes.push({ userId: 'voter', studentId: 'student-06', stage: 'final' })
  const restored = JSON.parse(JSON.stringify(db))
  assert.equal(initializeFinal(restored, config), false)
  assert.equal(restored.votes.length, 2)
  assert.equal(rank(config.students, restored.votes, 'final')[0].id, 'student-06')
})

test('final configuration ends Friday at 22:00 Kyiv and excludes eliminated participants', () => {
  assert.equal(config.final.deadline, '2026-11-13T22:00:00+02:00')
  assert.equal(new Date(config.final.deadline).getUTCDay(), 5)
  assert.deepEqual(config.students.map(student => student.id), config.final.participantIds)
})
