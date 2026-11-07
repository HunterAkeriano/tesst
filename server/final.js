export function initializeFinal(db, config) {
  const final = config.final
  if (!final.enabled || !final.roundId || db.finalRoundId === final.roundId) return false
  const ids = final.participantIds
  if (!Array.isArray(ids) || ids.length !== 3 || new Set(ids).size !== 3 || !ids.every(id => config.students.some(student => student.id === id))) throw new Error('Invalid finalists')
  db.votes = db.votes.filter(vote => vote.stage !== 'final')
  db.semifinalists = [...ids]
  db.winners = null
  db.finalRoundId = final.roundId
  return true
}
