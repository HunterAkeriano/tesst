export function initializeRound(db, config) {
  if (!config.roundId || db.roundId === config.roundId) return false
  db.votes = []
  db.semifinalists = null
  db.winners = null
  delete db.finalRoundId
  delete db.adjustments
  delete db.recoveries
  db.roundId = config.roundId
  return true
}
