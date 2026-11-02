export function parseVideo(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  if (/^[\w-]{11}$/.test(value)) return youtube(value)
  try {
    const url = new URL(value)
    if (!['https:', 'http:'].includes(url.protocol)) return null
    if (['youtu.be', 'www.youtu.be'].includes(url.hostname)) return youtube(url.pathname.slice(1))
    if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname)) {
      return youtube(url.searchParams.get('v') || url.pathname.match(/^\/(?:shorts|embed)\/([\w-]+)/)?.[1] || '', url.pathname.startsWith('/shorts/'))
    }
    if (['tiktok.com', 'www.tiktok.com', 'm.tiktok.com'].includes(url.hostname)) {
      const id = url.pathname.match(/^\/@[^/]+\/video\/(\d{15,25})\/?$/)?.[1]
      if (id) return { provider: 'TikTok', id, portrait: true, url: `https://www.tiktok.com${url.pathname}`, embed: `https://www.tiktok.com/player/v1/${id}?autoplay=1&rel=0`, thumbnail: '' }
    }
  } catch {}
  return null
}

function youtube(id, portrait = false) {
  if (!/^[\w-]{11}$/.test(id)) return null
  return { provider: 'YouTube', id, portrait, url: `https://www.youtube.com/watch?v=${id}`, embed: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`, thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` }
}
