import { randomBytes } from 'node:crypto'
import { db, digest, save } from './store.js'

db.devices ??= []
const options = { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', maxAge: 365 * 86400000 }

export function identifyDevice(req, res, next) {
  const token = req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith('device='))?.slice(7)
  req.device = token && /^[a-f0-9]{64}$/.test(token) ? db.devices.find(d => d.hash === digest(token)) : null
  if (!req.device && req.method === 'GET' && req.path === '/contest') {
    const created = randomBytes(32).toString('hex')
    req.device = { hash: digest(created), registrations: 0 }
    db.devices.push(req.device)
    save()
    res.cookie('device', created, options)
  }
  next()
}

export function deviceLimit(req, res, next) {
  if (!req.device) return res.status(403).json({ error: 'Увімкніть cookies та оновіть сторінку перед реєстрацією.' })
  if (req.device.registrations >= 2) return res.status(403).json({ error: 'У цьому браузері вже створено два облікові записи. Увійдіть в один із них.' })
  next()
}
