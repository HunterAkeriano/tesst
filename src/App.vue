<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { parseVideo } from '../shared/video.js'

const contest = ref(null)
const failure = ref('')
const toast = ref('')
const now = ref(Date.now())
let offset = 0
const modal = ref(null)
const selected = ref(null)
const busy = ref(false)
const authMode = ref('register')
const form = ref({ name: '', email: '', password: '' })
const formError = ref('')
const dialog = ref(null)
const videoFrame = ref(null)
const playerStatus = ref('loading')
let playerTimer
let previousFocus
let refreshTimer
let clockTimer
let toastTimer
const active = computed(() => ['selection', 'final'].includes(contest.value?.phase))
const isFinal = computed(() => ['final', 'finished'].includes(contest.value?.phase))
const remaining = computed(() => {
  const seconds = Math.max(0, Math.floor((Date.parse(contest.value?.deadline) - now.value) / 1000))
  return [Math.floor(seconds / 86400), Math.floor(seconds / 3600) % 24, Math.floor(seconds / 60) % 60, seconds % 60].map(n => String(n || 0).padStart(2, '0'))
})
const dateLabel = computed(() => contest.value ? new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kyiv' }).format(new Date(contest.value.deadline)) : '')
const hasExamples = computed(() => contest.value?.students.some(s => !media(s)))
const initials = name => name.split(' ').map(s => s[0]).slice(0, 2).join('')
const media = student => parseVideo(student?.video || student?.youtube)
const participants = computed(() => contest.value?.students.length ?? 0)
async function api(url, body) {
  const response = await fetch(`/api/${url}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'AI-Vote' }, body: JSON.stringify(body) })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || 'Не вдалося виконати запит.')
  return result
}
async function refresh() {
  try {
    contest.value = await api('contest')
    offset = contest.value.serverTime - Date.now()
    now.value = Date.now() + offset
    failure.value = ''
  } catch { failure.value = 'Не вдалося оновити дані. Перевірте з’єднання та спробуйте ще раз.' }
}
async function open(type, student = null) {
  clearTimeout(playerTimer)
  playerStatus.value = 'loading'
  if (type === 'video') playerTimer = setTimeout(() => { if (playerStatus.value === 'loading') playerStatus.value = 'slow' }, 15000)
  previousFocus = document.activeElement
  selected.value = student
  formError.value = ''
  modal.value = type
  document.body.style.overflow = 'hidden'
  await nextTick()
  dialog.value?.focus()
}
function close() {
  if (busy.value) return
  modal.value = null
  clearTimeout(playerTimer)
  form.value.password = ''
  document.body.style.overflow = ''
  previousFocus?.focus()
}
function playerMessage(event) {
  if (modal.value !== 'video' || event.origin !== 'https://www.tiktok.com' || event.source !== videoFrame.value?.contentWindow || !event.data?.['x-tiktok-player']) return
  if (['onPlayerReady', 'onStateChange', 'onCurrentTime'].includes(event.data.type)) {
    playerStatus.value = 'ready'
    clearTimeout(playerTimer)
  }
  if (event.data.type === 'onPlayerError') {
    playerStatus.value = event.data.value?.errorCode === 3002 ? 'autoplay' : 'error'
    clearTimeout(playerTimer)
  }
}
function playerLoaded() {
  if (media(selected.value)?.provider === 'YouTube') { playerStatus.value = 'ready'; clearTimeout(playerTimer) }
}
async function retryPlayer() {
  const student = selected.value
  modal.value = null
  await nextTick()
  await open('video', student)
}
function keydown(event) {
  if (!modal.value) return
  if (event.key === 'Escape') close()
  if (event.key !== 'Tab') return
  const nodes = [...dialog.value.querySelectorAll('button:not(:disabled), input, iframe, a[href]')]
  const first = nodes[0]
  const last = nodes.at(-1)
  if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.value)) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.value)) { event.preventDefault(); first?.focus() }
}
async function authenticate() {
  busy.value = true
  formError.value = ''
  try {
    await api(authMode.value, form.value)
    await refresh()
    busy.value = false
    if (selected.value && active.value && !contest.value.myVote) modal.value = 'vote'
    else close()
  } catch (error) { formError.value = error.message }
  finally { busy.value = false }
}
async function vote() {
  busy.value = true
  formError.value = ''
  try {
    await api('vote', { studentId: selected.value.id })
    await refresh()
    busy.value = false
    close()
    toast.value = 'Дякуємо! Ваш голос враховано.'
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => { toast.value = '' }, 5000)
  } catch (error) { formError.value = error.message; await refresh() }
  finally { busy.value = false }
}
async function logout() {
  try { await api('logout', {}); await refresh() } catch (error) { failure.value = error.message }
}
onMounted(() => {
  refresh()
  refreshTimer = setInterval(refresh, 10000)
  clockTimer = setInterval(() => {
    const before = now.value
    now.value = Date.now() + offset
    if (before < Date.parse(contest.value?.deadline) && now.value >= Date.parse(contest.value?.deadline)) refresh()
  }, 1000)
  document.addEventListener('keydown', keydown)
  window.addEventListener('message', playerMessage)
})
onUnmounted(() => {
  clearInterval(refreshTimer)
  clearInterval(clockTimer)
  clearTimeout(toastTimer)
  clearTimeout(playerTimer)
  window.removeEventListener('message', playerMessage)
  document.removeEventListener('keydown', keydown)
  document.body.style.overflow = ''
})
</script>

<template>
  <header class="header wrap">
    <a class="brand" href="#"><span class="brand-symbol">✳</span> КАДР <span class="brand-slash">/</span> AI</a>
    <nav><a href="#works">Роботи</a><button class="plain" @click="open('rules')">Як голосувати</button></nav>
    <button v-if="!contest?.user" class="login" @click="authMode = 'login'; open('auth')">Увійти <span>↗</span></button>
    <button v-else class="login user" @click="logout" :title="`${contest.user.name} · Вийти`">{{ contest.user.name }} <span>↪</span></button>
  </header>
  <main class="wrap">
    <div v-if="failure" class="notice error" role="alert">{{ failure }} <button @click="refresh">Повторити</button></div>
    <section class="hero">
      <div class="hero-copy">
        <div class="eyebrow"><span class="live-dot"></span> СТУДЕНТСЬКИЙ КОНКУРС AI-ВІДЕО <span class="edition">/ 2026</span></div>
        <h1 v-if="contest?.phase === 'finished'">Ваш вибір.<br><span class="serif">Наш переможець.</span></h1>
        <h1 v-else-if="contest?.phase === 'results'">{{ participants }} ідей.<br><span class="serif">Троє півфіналістів.</span></h1>
        <h1 v-else>Створено з AI.<br><span class="serif">Обрано тобою.</span></h1>
        <p>{{ participants }} учасників. Різні погляди на майбутнє.<br>Дивись відео та підтримай роботу, яка тебе зачепила.</p>
        <a class="primary hero-cta" href="#works">{{ active ? 'Обрати свій кадр' : 'Переглянути результати' }} <span>↙</span></a>
        <div class="hero-meta"><span class="mini-avatars"><i v-for="student in contest?.students.slice(0, 3)" :key="student.id">{{ initials(student.name) }}</i></span><span><b>{{ participants }} авторів</b> · лише 3 місця у півфіналі</span></div>
      </div>
      <div class="hero-art" aria-hidden="true">
        <div class="art-grid"></div><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><div class="art-orb"></div>
        <span class="art-top">HUMAN IDEAS. ARTIFICIAL INTELLIGENCE.</span>
        <div class="art-frame"><span>REC <i></i></span><span>AI / {{ String(participants).padStart(3, '0') }}</span></div>
        <span class="art-word">уяви<span>більше.</span></span>
        <span class="art-bottom">THE NEXT FRAME IS YOURS ↗</span><span class="art-sticker">{{ participants }} ІДЕЙ<br>1 ТВІЙ ГОЛОС</span>
      </div>
    </section>
    <section class="status-strip" aria-label="Статус голосування">
      <div class="stage-status"><span class="live-dot" :class="{ ended: !active }"></span><div><b>{{ active ? (isFinal ? 'Голосування серед трьох' : 'Обираємо півфіналістів') : 'Голосування завершено' }}</b><span>{{ dateLabel }} · за Києвом</span></div></div>
      <div class="countdown" v-if="active"><span class="countdown-label">ДО ЗАВЕРШЕННЯ</span><div v-for="(part, i) in remaining" :key="i"><strong>{{ part }}</strong><small>{{ ['днів', 'год', 'хв', 'сек'][i] }}</small></div></div>
      <div v-else class="closed-label">{{ contest?.phase === 'finished' ? 'Переможця визначено ↗' : 'Трійку півфіналістів визначено ↗' }}</div>
      <div class="vote-total"><strong>{{ contest?.totalVoters ?? '—' }}</strong><span>голосів віддано</span></div>
    </section>
    <section id="works" class="works">
      <div class="section-heading"><div><div class="eyebrow">ІДЕЇ, ЯКІ СТАЛИ ВІДЕО</div><h2>{{ active ? 'Знайди свого фаворита' : 'Ви зробили свій вибір' }}<sup>{{ participants }}</sup></h2></div><span class="sort-label">{{ contest?.totalVoters ? '↓ За кількістю голосів' : 'А–Я За прізвищем' }}</span></div>
      <div v-if="hasExamples" class="notice setup">Організатор ще додає відео до деяких робіт.</div>
      <div v-if="contest?.myVote" class="notice voted-notice">✓ Ваш голос враховано. Дякуємо за підтримку автора!</div>
      <div v-if="!contest && !failure" class="loading">Завантажуємо роботи…</div>
      <div class="cards">
        <article v-for="(student, index) in contest?.students" :key="student.id" class="student-card" :class="{ chosen: contest.myVote === student.id, qualified: contest.semifinalists?.includes(student.id) && !active }">
          <div class="card-content">
            <div class="student-info">
              <div class="card-top"><span class="rank">{{ String(index + 1).padStart(2, '0') }} <span>/</span></span><span class="badge" v-if="contest.phase === 'finished' && contest.winners?.[0] === student.id">↗ Переможець</span><span class="badge" v-else-if="contest.semifinalists?.includes(student.id) && !active">↗ Півфіналіст</span><span class="category" v-else>{{ media(student)?.provider || 'AI-відео' }}</span></div>
              <div class="author"><img v-if="student.avatar" :src="student.avatar" :alt="student.name" class="avatar" /><div v-else class="avatar" :class="`avatar-${index % 4}`">{{ initials(student.name) }}</div><div><h3>{{ student.name }}</h3><span>{{ student.group ? `Група ${student.group}` : 'Учасник конкурсу' }}</span></div></div>
              <h4>«{{ student.title }}»</h4>
              <div class="card-score"><span class="heart">♡</span><strong>{{ student.votes }}</strong><span>голосів</span><small v-if="active && index < 3 && student.votes > 0">У трійці лідерів</small></div>
            </div>
            <button class="video-cover" :class="{ tiktok: media(student)?.provider === 'TikTok' }" :aria-label="`Дивитися ${student.title}`" @click="open('video', student)">
              <img v-if="student.thumbnail || media(student)?.thumbnail" :src="student.thumbnail || media(student)?.thumbnail" alt="" loading="lazy" />
              <div v-else class="video-empty"><span>{{ media(student)?.provider || 'AI-відео' }}</span><strong>{{ student.videoUnavailable ? 'Відео недоступне' : 'Прев’ю відсутнє' }}</strong></div>
              <span class="video-format">{{ student.format === 'portrait' ? '9:16' : '16:9' }}</span><span v-if="!student.videoUnavailable" class="play">▶</span><span class="watch">{{ student.videoUnavailable ? 'Очікуємо нове посилання' : media(student) ? `Дивитися ${media(student).provider} ↗` : 'Відео незабаром' }}</span>
            </button>
          </div>
          <button class="vote-button" :class="{ selected: contest.myVote === student.id }" :disabled="!active || !!contest.myVote || !media(student)" @click="authMode = 'register'; open(contest.user ? 'vote' : 'auth', student)"><span>{{ contest.myVote === student.id ? '✓ Ваш голос' : !active ? (contest.semifinalists?.includes(student.id) ? 'У півфіналі' : 'Голосування завершено') : !media(student) ? 'Очікуємо на відео' : contest.myVote ? 'Ви вже проголосували' : 'Проголосувати' }}</span><span v-if="active && !contest.myVote && media(student)">↗</span></button>
        </article>
      </div>
    </section>
    <section class="how"><div><div class="eyebrow">ВСЕ ПРОСТО</div><h2>Твій голос.<br><span class="serif">Їхній наступний крок.</span></h2></div><div class="steps"><div><span>01</span><h3>Дивись</h3><p>Відкрий відео та познайомся з ідеями учасників.</p></div><div><span>02</span><h3>Реєструйся</h3><p>Введи ім’я, email та створи пароль.</p></div><div><span>03</span><h3>Обирай</h3><p>Один голос за одну роботу. Троє найкращих пройдуть далі.</p></div></div></section>
  </main>
  <footer class="wrap"><a class="brand" href="#"><span class="brand-symbol">✳</span> КАДР / AI</a><span>Людська уява. Нові можливості.</span><button class="plain" @click="open('rules')">Правила голосування ↗</button><span>© 2026</span></footer>
  <div v-if="toast" class="toast" role="status">{{ toast }}</div>
  <Teleport to="body">
    <div v-if="modal" class="modal-backdrop" @click.self="close">
      <section ref="dialog" class="modal" :class="{ 'video-modal': modal === 'video', portrait: modal === 'video' && selected.format === 'portrait' }" role="dialog" aria-modal="true" aria-labelledby="modal-title" tabindex="-1">
        <button class="close" aria-label="Закрити" @click="close" :disabled="busy">×</button>
        <template v-if="modal === 'auth'">
          <div class="eyebrow">ТВІЙ ГОЛОС МАЄ ЗНАЧЕННЯ</div><h2 id="modal-title">{{ authMode === 'register' ? 'Приєднуйся до вибору' : 'З поверненням!' }}</h2><p>Зареєструйся з email та підтримай свого фаворита. Один обліковий запис — один голос на етапі.</p>
          <div class="auth-tabs"><button :class="{ current: authMode === 'register' }" @click="authMode = 'register'; formError = ''">Реєстрація</button><button :class="{ current: authMode === 'login' }" @click="authMode = 'login'; formError = ''">Вхід</button></div>
          <form @submit.prevent="authenticate"><label v-if="authMode === 'register'">Ім’я та прізвище<input v-model="form.name" autocomplete="name" placeholder="Як до тебе звертатися?" required minlength="2" maxlength="80" /></label><label>Email<input v-model="form.email" type="email" autocomplete="username" placeholder="you@example.com" required maxlength="254" /></label><label>Пароль<input v-model="form.password" :autocomplete="authMode === 'register' ? 'new-password' : 'current-password'" type="password" placeholder="Щонайменше 8 символів" required minlength="8" maxlength="128" /></label><p v-if="formError" class="form-error" role="alert">{{ formError }}</p><button class="primary full" :disabled="busy">{{ busy ? 'Зачекайте…' : authMode === 'register' ? 'Зареєструватися ↗' : 'Увійти ↗' }}</button><small>Для наступного входу використовуй email і пароль. Твої дані не відображаються публічно. У цьому браузері можна створити не більше двох облікових записів.</small></form>
        </template>
        <template v-else-if="modal === 'video'"><h2 id="modal-title">{{ selected.title }}</h2><p>{{ selected.name }}{{ selected.group ? ` · ${selected.group}` : '' }}</p><div v-if="selected.videoUnavailable" class="video-placeholder"><h3>Відео недоступне в TikTok</h3><p>Платформа позначає цей ролик як видалений. Очікуємо від автора нове посилання.</p></div><iframe ref="videoFrame" @load="playerLoaded" @error="playerStatus = 'error'" v-else-if="media(selected)" :src="media(selected).embed" :title="selected.title" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe><div v-else class="video-placeholder"><span>▷</span><h3>Цей кадр ще попереду</h3><p>Організатор незабаром додасть відео учасника.</p></div><div v-if="media(selected) && !selected.videoUnavailable && playerStatus !== 'ready'" class="player-status" role="status"><span>{{ playerStatus === 'loading' ? 'Завантажуємо відео…' : playerStatus === 'autoplay' ? 'Натисніть ▶ у плеєрі, щоб почати перегляд.' : 'Плеєр не відповідає. Спробуйте ще раз або відкрийте відео на платформі.' }}</span><button v-if="['slow', 'error'].includes(playerStatus)" class="plain" @click="retryPlayer">Спробувати ще раз</button></div><a v-if="media(selected)" class="video-external" :href="media(selected).url" target="_blank" rel="noopener noreferrer">Відкрити в {{ media(selected).provider }} ↗</a></template>
        <template v-else-if="modal === 'vote'"><div class="eyebrow">ПІДТРИМАЙ СВОГО ФАВОРИТА</div><h2 id="modal-title">Це твій вибір?</h2><p>Ти голосуєш за <strong>{{ selected.name }}</strong> та роботу «{{ selected.title }}».</p><div class="notice">На цьому етапі можна проголосувати лише один раз. Змінити голос після підтвердження не можна.</div><p v-if="formError" class="form-error" role="alert">{{ formError }}</p><button class="primary full" @click="vote" :disabled="busy">{{ busy ? 'Враховуємо голос…' : 'Так, проголосувати ↗' }}</button><button class="plain cancel" @click="close" :disabled="busy">Ще подумаю</button></template>
        <template v-else><div class="eyebrow">ЧЕСНИЙ ВИБІР</div><h2 id="modal-title">Як це працює</h2><ol class="rules"><li>Зареєструйся з іменем, email та паролем.</li><li>Переглянь роботи й віддай один голос одному автору. Змінити голос не можна.</li><li>Відбір завершується 6 листопада 2026 року о 13:10 за Києвом. Троє учасників із найбільшою кількістю голосів стають півфіналістами.</li><li>Учасники розташовані за кількістю голосів. За однакової кількості — за прізвищем в українському алфавітному порядку. Це правило також визначає трійку півфіналістів.</li><li>Голосування серед трьох організатор запустить окремо. Голоси цього етапу не переносяться; кожен зможе проголосувати знову.</li></ol><p class="privacy">Зберігаємо ім’я, email, захищений пароль і факт голосування. Не публікуємо, хто за кого проголосував. Для обмеження двох реєстрацій зберігаємо ідентифікатор браузера в cookie. Не передавай свій пароль іншим.</p></template>
      </section>
    </div>
  </Teleport>
</template>
