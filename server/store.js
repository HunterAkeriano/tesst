import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomBytes } from 'node:crypto'

export const digest = value => createHash('sha256').update(value).digest('hex')
export const dataDir = path.resolve(process.env.DATA_DIR || 'data')
fs.mkdirSync(dataDir, { recursive: true })
const file = path.join(dataDir, 'votes.json')
export const db = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {
  users: [], sessions: [], votes: [], semifinalists: null, winners: null
}
export function lock() {
  const lockFile = path.join(dataDir, 'server.lock')
  if (fs.existsSync(lockFile)) {
    const pid = Number(fs.readFileSync(lockFile, 'utf8'))
    let running = true
    try { process.kill(pid, 0) } catch (error) { if (error.code === 'ESRCH') running = false }
    if (running) throw new Error('Data is in use. Run only one server instance.')
    fs.unlinkSync(lockFile)
  }
  fs.writeFileSync(lockFile, String(process.pid), { flag: 'wx', mode: 0o600 })
  process.on('exit', () => { if (fs.existsSync(lockFile) && fs.readFileSync(lockFile, 'utf8') === String(process.pid)) fs.unlinkSync(lockFile) })
  process.on('SIGTERM', () => process.exit(0))
  process.on('SIGINT', () => process.exit(0))
}
export function save() {
  const temporary = `${file}.${randomBytes(6).toString('hex')}.tmp`
  fs.writeFileSync(temporary, JSON.stringify(db, null, 2), { mode: 0o600 })
  fs.renameSync(temporary, file)
}
export function rank(students, votes, stage) {
  return students.map(student => {
    const entries = votes.filter(vote => vote.stage === stage && vote.studentId === student.id)
    return { ...student, votes: entries.length, reachedAt: entries.at(-1)?.at ?? Number.MAX_SAFE_INTEGER }
  }).sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name, 'uk') || a.id.localeCompare(b.id))
}
export function advance(config, now = Date.now()) {
  if (now >= Date.parse(config.deadline) && db.semifinalists === null) {
    db.semifinalists = rank(config.students, db.votes, 'selection').slice(0, 3).map(s => s.id)
    save()
  }
  if (config.final.enabled && now >= Date.parse(config.final.deadline) && db.winners === null) {
    db.winners = rank(config.students.filter(s => db.semifinalists.includes(s.id)), db.votes, 'final').map(s => s.id)
    save()
  }
  if (!db.semifinalists) return 'selection'
  if (config.final.enabled && now >= Date.parse(config.final.startsAt)) return db.winners ? 'finished' : 'final'
  return 'results'
}
