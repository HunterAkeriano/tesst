import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseVideo } from '../shared/video.js'
import { rank } from '../server/store.js'

test('YouTube, Shorts and TikTok use official players with validated hosts', () => {
  assert.equal(parseVideo('https://youtu.be/zi3R4Z0AYjE').provider, 'YouTube')
  assert.equal(parseVideo('https://youtube.com/shorts/ooFmUtN-xpE?si=test').portrait, true)
  assert.equal(parseVideo('https://www.tiktok.com/@katya2007_8/video/7702118810077138228').embed, 'https://www.tiktok.com/player/v1/7702118810077138228?autoplay=1&rel=0')
  for (const value of ['https://youtube.com.evil.test/watch?v=zi3R4Z0AYjE', 'javascript:alert(1)', 'https://evil.test/@user/video/7702118810077138228', '', 'https://www.tiktok.com/@user/video/not-an-id']) assert.equal(parseVideo(value), null)
})

test('votes sort first, Ukrainian surname sorts equal scores', () => {
  const students = [{ id: '3', name: 'Школун Ярослав' }, { id: '2', name: 'Жєлєзняк Катерина' }, { id: '1', name: 'Боярський Михайло' }]
  assert.deepEqual(rank(students, [], 'selection').map(s => s.id), ['1', '2', '3'])
  const votes = [{ studentId: '3', stage: 'selection', at: 1 }, { studentId: '2', stage: 'selection', at: 2 }]
  assert.deepEqual(rank(students, votes, 'selection').map(s => s.id), ['2', '3', '1'])
  votes.push({ studentId: '3', stage: 'selection', at: 3 })
  assert.deepEqual(rank(students, votes, 'selection').map(s => s.id), ['3', '2', '1'])
})
