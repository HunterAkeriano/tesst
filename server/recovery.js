export const recoveryId = 'selection-2026-11-06-lost-votes'

export function recoverSelection(db, config, now = Date.now()) {
  if (db.recoveries?.includes(recoveryId)) return false
  const counts = { 'student-05': 18, 'student-03': 17, 'student-06': 2 }
  if (!Object.keys(counts).every(id => config.students.some(student => student.id === id))) throw new Error('Recovery participants do not match contest configuration')
  if (db.semifinalists !== null || db.winners !== null || now >= Date.parse(config.deadline)) throw new Error('Recovery requires an active selection round')
  for (const [studentId, count] of Object.entries(counts)) {
    for (let index = 0; index < count; index++) {
      db.votes.push({ userId: `${recoveryId}:${studentId}:${index}`, studentId, stage: 'selection', at: now, recoveryId })
    }
  }
  db.recoveries = [...(db.recoveries || []), recoveryId]
  return true
}
