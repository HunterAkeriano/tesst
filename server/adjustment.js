export const adjustmentId = 'final-2026-11-13-student-06-total-20'
export const mamaiAdjustmentId = 'final-2026-11-13-student-05-add-18'

export function adjustMamaiVotes(db, config, now = Date.now()) {
  if (db.adjustments?.includes(mamaiAdjustmentId)) return false
  if (!config.final.enabled || config.final.roundId !== 'final-2026-11-13' || db.finalRoundId !== config.final.roundId) return false
  if (now < Date.parse(config.final.startsAt) || now >= Date.parse(config.final.deadline) || db.winners !== null) return false
  if (!db.semifinalists?.includes('student-05') || !config.students.some(student => student.id === 'student-05')) return false
  for (let index = 0; index < 18; index++) {
    db.votes.push({ userId: `${mamaiAdjustmentId}:${index}`, studentId: 'student-05', stage: 'final', at: now, adjustmentId: mamaiAdjustmentId })
  }
  db.adjustments = [...(db.adjustments || []), mamaiAdjustmentId]
  return true
}

export function adjustNikitaVotes(db, config, now = Date.now()) {
  if (db.adjustments?.includes(adjustmentId)) return false
  if (!config.final.enabled || config.final.roundId !== 'final-2026-11-13' || db.finalRoundId !== config.final.roundId) return false
  if (now < Date.parse(config.final.startsAt) || now >= Date.parse(config.final.deadline) || db.winners !== null) return false
  if (!db.semifinalists?.includes('student-06') || !config.students.some(student => student.id === 'student-06')) return false
  const count = db.votes.filter(vote => vote.stage === 'final' && vote.studentId === 'student-06').length
  for (let index = count; index < 20; index++) {
    db.votes.push({ userId: `${adjustmentId}:${index}`, studentId: 'student-06', stage: 'final', at: now, adjustmentId })
  }
  db.adjustments = [...(db.adjustments || []), adjustmentId]
  return true
}
