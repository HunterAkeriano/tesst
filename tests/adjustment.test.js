import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { adjustNikitaVotes, adjustmentId, adjustMamaiVotes, mamaiAdjustmentId } from '../server/adjustment.js'

const config = JSON.parse(fs.readFileSync('tests/fixtures/previous-contest.json', 'utf8'))
const now = Date.parse('2026-11-11T12:00:00+02:00')
const makeDb = count => ({
  users: [{ id: 'existing-user' }],
  sessions: [{ userId: 'existing-user' }],
  devices: [{ registrations: 2 }],
  finalRoundId: config.final.roundId,
  semifinalists: [...config.final.participantIds],
  winners: null,
  votes: [
    { userId: 'other', studentId: 'student-05', stage: 'final' },
    { userId: 'selection', studentId: 'student-06', stage: 'selection' },
    ...Array.from({ length: count }, (_, index) => ({ userId: `voter-${index}`, studentId: 'student-06', stage: 'final' }))
  ]
})

test('adjustment reaches 135, preserves existing data and runs once after restart', () => {
  const db = makeDb(7)
  const before = structuredClone(db)
  assert.equal(adjustNikitaVotes(db, config, now), true)
  assert.equal(db.votes.filter(vote => vote.stage === 'final' && vote.studentId === 'student-06').length, 135)
  assert.deepEqual(db.votes.slice(0, before.votes.length), before.votes)
  for (const key of Object.keys(before).filter(key => key !== 'votes')) assert.deepEqual(db[key], before[key])
  assert.equal(db.votes.filter(vote => vote.adjustmentId === adjustmentId).length, 128)
  const restored = JSON.parse(JSON.stringify(db))
  restored.votes.push({ userId: 'next-voter', studentId: 'student-06', stage: 'final' })
  const expected = structuredClone(restored)
  assert.equal(adjustNikitaVotes(restored, config, now), false)
  assert.deepEqual(restored, expected)
})

test('Mamai reaches 150 votes once while preserving Nikita adjustment and existing data', () => {
  const db = makeDb(7)
  adjustNikitaVotes(db, config, now)
  const before = structuredClone(db)
  assert.equal(adjustMamaiVotes(db, config, now), true)
  assert.equal(db.votes.filter(vote => vote.stage === 'final' && vote.studentId === 'student-05').length, 150)
  assert.equal(db.votes.filter(vote => vote.adjustmentId === mamaiAdjustmentId).length, 149)
  assert.deepEqual(db.votes.slice(0, before.votes.length), before.votes)
  for (const key of Object.keys(before).filter(key => !['votes', 'adjustments'].includes(key))) assert.deepEqual(db[key], before[key])
  assert.deepEqual(db.adjustments, [adjustmentId, mamaiAdjustmentId])
  const restored = JSON.parse(JSON.stringify(db))
  const expected = structuredClone(restored)
  assert.equal(adjustMamaiVotes(restored, config, now), false)
  assert.equal(adjustNikitaVotes(restored, config, now), false)
  assert.deepEqual(restored, expected)
})

test('new targets apply after previous 136 and 120 vote adjustments', () => {
  const db = makeDb(120)
  db.votes.push(...Array.from({ length: 135 }, (_, index) => ({ userId: `mamai-${index}`, studentId: 'student-05', stage: 'final' })))
  db.adjustments = ['final-2026-11-13-student-05-total-136', 'final-2026-11-13-student-06-total-120']
  assert.equal(adjustMamaiVotes(db, config, now), true)
  assert.equal(adjustNikitaVotes(db, config, now), true)
  assert.equal(db.votes.filter(vote => vote.adjustmentId === mamaiAdjustmentId).length, 14)
  assert.equal(db.votes.filter(vote => vote.adjustmentId === adjustmentId).length, 15)
  assert.equal(db.votes.filter(vote => vote.stage === 'final' && vote.studentId === 'student-05').length, 150)
  assert.equal(db.votes.filter(vote => vote.stage === 'final' && vote.studentId === 'student-06').length, 135)
  const restored = JSON.parse(JSON.stringify(db))
  assert.equal(adjustMamaiVotes(restored, config, now), false)
  assert.equal(adjustNikitaVotes(restored, config, now), false)
  assert.deepEqual(restored, db)
})

test('Mamai adjustment skips inactive rounds and missing participants', () => {
  for (const [changes, contest, time] of [
    [{ finalRoundId: 'different-round' }, config, now],
    [{ winners: ['student-05'] }, config, now],
    [{ semifinalists: ['student-06'] }, config, now],
    [{}, { ...config, students: [] }, now],
    [{}, { ...config, final: { ...config.final, enabled: false } }, now],
    [{}, config, Date.parse(config.final.startsAt) - 1],
    [{}, config, Date.parse(config.final.deadline)]
  ]) {
    const db = { ...makeDb(3), ...changes }
    const before = structuredClone(db)
    assert.equal(adjustMamaiVotes(db, contest, time), false)
    assert.deepEqual(db, before)
  }
})

test('adjustment never removes votes when 135 or more already exist', () => {
  for (const count of [135, 138]) {
    const db = makeDb(count)
    const votes = structuredClone(db.votes)
    assert.equal(adjustNikitaVotes(db, config, now), true)
    assert.deepEqual(db.votes, votes)
  }
})

test('adjustment leaves other rounds and finalized results unchanged', () => {
  for (const [changes, time] of [
    [{ finalRoundId: 'different-round' }, now],
    [{ winners: ['student-05'] }, now],
    [{ semifinalists: ['student-05'] }, now],
    [{}, Date.parse(config.final.startsAt) - 1],
    [{}, Date.parse(config.final.deadline)]
  ]) {
    const db = { ...makeDb(3), ...changes }
    const before = structuredClone(db)
    assert.equal(adjustNikitaVotes(db, config, time), false)
    assert.deepEqual(db, before)
  }
})
