import { test } from 'node:test'
import assert from 'node:assert/strict'
import { recoverSelection, recoveryId } from '../server/recovery.js'
import { rank } from '../server/store.js'

const config = { deadline: '2026-11-06T23:00:00+02:00', students: [{ id: 'student-05', name: 'Мамай' }, { id: 'student-03', name: 'Жєлєзняк' }, { id: 'student-06', name: 'Сюзєв' }] }
const now = Date.parse('2026-11-06T14:00:00+02:00')
const empty = () => ({ users: [], sessions: [], votes: [], semifinalists: null, winners: null })

test('recovery preserves new votes and is not repeated after persistence', () => {
  const db = empty()
  db.votes.push({ userId: 'new-voter', studentId: 'student-05', stage: 'selection', at: now - 1 })
  assert.equal(recoverSelection(db, config, now), true)
  assert.deepEqual(rank(config.students, db.votes, 'selection').map(s => s.votes), [19, 17, 2])
  assert.equal(db.votes[0].userId, 'new-voter')
  assert.equal(db.users.length, 0)
  assert.equal(db.votes.filter(v => v.recoveryId === recoveryId).length, 37)
  const restored = JSON.parse(JSON.stringify(db))
  assert.equal(recoverSelection(restored, config, now), false)
  assert.equal(restored.votes.length, 38)
})

test('recovery rejects ended rounds and mismatched participants without changing votes', () => {
  for (const [db, contest, time] of [[empty(), config, Date.parse(config.deadline)], [{ ...empty(), semifinalists: ['student-05'] }, config, now], [empty(), { ...config, students: [] }, now]]) {
    assert.throws(() => recoverSelection(db, contest, time))
    assert.deepEqual(db.votes, [])
    assert.equal(db.recoveries, undefined)
  }
})
