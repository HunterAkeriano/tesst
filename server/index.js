import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { db, save, digest, rank, advance, lock, dataDir } from './store.js'
import { recoverSelection, recoveryId } from './recovery.js'
import { identifyDevice, deviceLimit } from './device.js'
import { parseVideo } from '../shared/video.js'

lock()
const scrypt = promisify(scryptCallback)
const config = JSON.parse(fs.readFileSync(process.env.CONFIG_PATH || 'config/contest.json', 'utf8'))
if (config.students.length < 3 || new Set(config.students.map(s => s.id)).size !== config.students.length || !Number.isFinite(Date.parse(config.deadline))) throw new Error('Invalid contest configuration')
if (config.final.enabled && !(Date.parse(config.final.startsAt) >= Date.parse(config.deadline) && Date.parse(config.final.deadline) > Date.parse(config.final.startsAt))) throw new Error('Invalid final dates')
if (process.env.RECOVER_SELECTION_2026_11_06 === '1' && !db.recoveries?.includes(recoveryId)) {
  if (process.env.RAILWAY_ENVIRONMENT_ID && !process.env.RAILWAY_VOLUME_MOUNT_PATH) throw new Error('Attach a Railway volume before recovering votes')
  fs.writeFileSync(path.join(dataDir, `before-recovery-${Date.now()}.json`), JSON.stringify(db, null, 2), { flag: 'wx', mode: 0o600 })
  recoverSelection(db, config)
  save()
  console.log('Recovered selection votes: Mamai 18, Zheliezniak 17, Siuziev 2')
}
const app = express()
app.disable('x-powered-by')
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1)
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' https: data:; frame-src https://www.youtube-nocookie.com https://www.tiktok.com; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'" })
  next()
})
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store')
  if (req.method === 'POST' && req.get('X-Requested-With') !== 'AI-Vote') return res.status(403).json({ error: 'Оновіть сторінку та спробуйте ще раз.' })
  next()
})
app.use(express.json({ limit: '8kb' }))
app.use('/api', identifyDevice)
const attempts = new Map()
setInterval(() => { for (const [key, item] of attempts) if (item.until < Date.now()) attempts.delete(key) }, 60000).unref()
function limit(req, res, next) {
  const key = req.ip
  const item = attempts.get(key)
  if (!item || item.until < Date.now()) attempts.set(key, { count: 1, until: Date.now() + 600000 })
  else if (++item.count > 30) return res.status(429).json({ error: 'Забагато спроб. Спробуйте через 10 хвилин.' })
  next()
}
function user(req) {
  const token = req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith('session='))?.slice(8)
  const session = token && db.sessions.find(s => s.token === digest(token) && s.expires > Date.now())
  return session && db.users.find(u => u.id === session.userId)
}
function signIn(res, account) {
  const token = randomBytes(32).toString('hex')
  db.sessions = db.sessions.filter(s => s.expires > Date.now() && s.userId !== account.id)
  db.sessions.push({ token: digest(token), userId: account.id, expires: Date.now() + 30 * 86400000 })
  save()
  res.cookie('session', token, { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', maxAge: 30 * 86400000 })
  res.json({ ok: true })
}
app.get('/api/contest', (req, res) => {
  const phase = advance(config)
  const account = user(req)
  const stage = ['final', 'finished'].includes(phase) ? 'final' : 'selection'
  const students = stage === 'final' ? config.students.filter(s => db.semifinalists.includes(s.id)) : config.students
  res.json({ title: config.title, phase, serverTime: Date.now(), deadline: stage === 'final' ? config.final.deadline : config.deadline, students: rank(students, db.votes, stage).map(({ reachedAt, ...s }) => s), semifinalists: db.semifinalists, winners: db.winners, user: account ? { name: account.name } : null, myVote: account ? db.votes.find(v => v.userId === account.id && v.stage === stage)?.studentId || null : null, totalVoters: db.votes.filter(v => v.stage === stage).length })
})
app.post('/api/register', limit, deviceLimit, async (req, res) => {
  const { name, email, password } = req.body || {}
  if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 80 || typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || typeof password !== 'string' || password.length < 8 || password.length > 128) return res.status(400).json({ error: 'Вкажіть ім’я, коректний email та пароль від 8 символів.' })
  const normalizedEmail = email.trim().toLowerCase()
  if (db.users.some(u => u.email === normalizedEmail)) return res.status(409).json({ error: 'Цей email уже зареєстрований. Увійдіть у свій обліковий запис.' })
  const salt = randomBytes(16).toString('hex')
  const hash = (await scrypt(password, salt, 64)).toString('hex')
  if (req.device.registrations >= 2) return res.status(403).json({ error: 'У цьому браузері вже створено два облікові записи. Увійдіть в один із них.' })
  if (db.users.some(u => u.email === normalizedEmail)) return res.status(409).json({ error: 'Цей email уже зареєстрований.' })
  const account = { id: randomBytes(16).toString('hex'), name: name.trim(), email: normalizedEmail, salt, hash }
  db.users.push(account)
  req.device.registrations += 1
  signIn(res, account)
})
app.post('/api/login', limit, async (req, res) => {
  const { email, password } = req.body || {}
  if (typeof email !== 'string' || email.length > 254 || typeof password !== 'string' || password.length > 128) return res.status(400).json({ error: 'Вкажіть email та пароль.' })
  const account = db.users.find(u => u.email === email.trim().toLowerCase())
  const hash = await scrypt(password, account?.salt || 'invalid-account-salt', 64)
  if (!account || !timingSafeEqual(hash, Buffer.from(account.hash, 'hex'))) return res.status(401).json({ error: 'Неправильний email або пароль.' })
  signIn(res, account)
})
app.post('/api/logout', (req, res) => {
  const account = user(req)
  if (account) { db.sessions = db.sessions.filter(s => s.userId !== account.id); save() }
  res.clearCookie('session').json({ ok: true })
})
app.post('/api/vote', limit, (req, res) => {
  const account = user(req)
  if (!account) return res.status(401).json({ error: 'Спочатку зареєструйтеся або увійдіть.' })
  const phase = advance(config)
  if (!['selection', 'final'].includes(phase)) return res.status(409).json({ error: 'Голосування завершено.' })
  const student = config.students.find(s => s.id === req.body?.studentId)
  if (!student || (phase === 'final' && !db.semifinalists.includes(student.id))) return res.status(400).json({ error: 'Учасника не знайдено.' })
  if (!parseVideo(student.video || student.youtube)) return res.status(400).json({ error: 'Голосування за цю роботу стане доступним після додавання відео.' })
  if (db.votes.some(v => v.userId === account.id && v.stage === phase)) return res.status(409).json({ error: 'Ваш голос на цьому етапі вже враховано.' })
  db.votes.push({ userId: account.id, studentId: student.id, stage: phase, at: Date.now() })
  save()
  res.json({ ok: true })
})
app.use(express.static(path.resolve('dist')))
app.get('/', (req, res) => res.sendFile(path.resolve('dist/index.html')))
app.use((error, req, res, next) => {
  console.error(error.message)
  res.status(error.status === 400 ? 400 : 500).json({ error: 'Не вдалося виконати запит. Спробуйте ще раз.' })
})
app.listen(Number(process.env.PORT || 3000), '0.0.0.0', () => console.log(`AI Vote: http://localhost:${process.env.PORT || 3000}`))
