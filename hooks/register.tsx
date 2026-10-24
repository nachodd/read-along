import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionMessage } from 'claude-code'

import type { Lang, Provider, Reading, Sentence, VoiceSettings } from '../types'

// The Python engine ships beside hooks/: speak.py and the sentence reader.
const helper = ($: EngineInterface) => `${$.plugin.root}/engine/read_sentences.py`
const speakPy = ($: EngineInterface) => `${$.plugin.root}/engine/speak.py`

const IDLE: Reading = { sources: [], items: [], at: -1, lang: null }
const DEFAULT_VOICES: VoiceSettings['voices'] = {
  kokoro: { es: 'ef_dora', en: 'af_heart' },
  system: { es: 'Mónica', en: 'Samantha' },
}
const DEFAULTS: VoiceSettings = {
  lang: 'auto',
  autoRead: false,
  speed: 1,
  provider: 'kokoro',
  voices: DEFAULT_VOICES,
}
const LANG_CYCLE: VoiceSettings['lang'][] = ['auto', 'es', 'en']

const reading = atom({ plugin: 'read-along', key: 'reading' } as const, IDLE, {
  shape: 'reading-2',
})
const settings = atom({ plugin: 'read-along', key: 'settings' } as const, DEFAULTS, {
  shape: 'settings-1',
})

type Run = { id: number; stream: AsyncGenerator<unknown, unknown>; control?: string }

// One reading at a time; a reload starts over with none.
let current: Run | null = null
let runs = 0

const ES_HINTS = /[ñ¿¡áéíóú]|\b(que|el|los|las|una|para|con|por|del|está|pero|como|también|más)\b/gi
const EN_HINTS = /\b(the|and|is|are|to|of|you|that|this|with|for|it|be|was|but)\b/gi

function detectLang(text: string): Lang {
  const es = text.match(ES_HINTS)?.length ?? 0
  const en = text.match(EN_HINTS)?.length ?? 0
  return en > es ? 'en' : 'es'
}

// Kokoro names say the language (`ef_dora`, `af_heart`); other providers' do not.
function voiceLang(voice: string): Lang | null {
  if (/^e[fm]_/.test(voice)) return 'es'
  if (/^[ab][fm]_/.test(voice)) return 'en'
  return null
}

function voiceFor(s: VoiceSettings, lang: Lang): string {
  return s.voices[s.provider]?.[lang] ?? DEFAULT_VOICES[s.provider]?.[lang] ?? ''
}

// Replies newest first: each one the text blocks the assistant wrote after a prompt.
function replies(messages: readonly SessionMessage[]): string[][] {
  const found: string[][] = []
  let reply: string[] = []
  for (const m of messages) {
    const isPrompt = m.role === 'user' && !m.toolResults?.length && m.text.trim() !== ''
    if (isPrompt) {
      if (reply.length > 0) found.push(reply)
      reply = []
    } else if (m.role === 'assistant' && m.text.trim() !== '') {
      reply.push(m.text)
    }
  }
  if (reply.length > 0) found.push(reply)

  return found.reverse()
}

// Markup speak.py strips from what it says: what may sit between two spoken letters.
const MARKUP_ATOM = String.raw`[*_\x60~\[]|\]\([^)\s]*\)`
const MARKUP = `(?:${MARKUP_ATOM})*`

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Where a spoken sentence sits in the markdown, at or after `from`: its letters
// in order, markup allowed between them; null when it cannot be found.
function locate(markdown: string, sentence: string, from: number): [number, number] | null {
  const pattern = [...sentence.trim()]
    .map(c => (/\s/.test(c) ? `(?:\\s|${MARKUP_ATOM})+` : escapeRegex(c)))
    .join(MARKUP)
  if (!pattern) return null
  const re = new RegExp(pattern, 'g')
  re.lastIndex = from
  const m = re.exec(markdown)

  return m ? [m.index, m.index + m[0].length] : null
}

// The markdown with the last of `said` marked, the rest as written: a plain
// sentence becomes inline code (drawn in color); one holding markup of its own
// keeps it, a ▸ before it, so no formatting breaks.
function markSentence(markdown: string, said: string[]): string {
  let cursor = 0
  let span: [number, number] | null = null
  for (const sentence of said) {
    const found = locate(markdown, sentence, cursor)
    if (found) {
      span = found
      cursor = found[1]
    } else {
      span = null
    }
  }
  if (!span) return markdown
  const [start, end] = span
  const inner = markdown.slice(start, end)
  const before = markdown.slice(0, start)
  const after = markdown.slice(end)
  const isPlain = !/[*_\x60~\[\]]/.test(inner) && !/[*_\x60]$/.test(before) && !/^[*_\x60]/.test(after)

  return isPlain ? `${before}\x60${inner}\x60${after}` : `${before}\u25B8 ${inner}${after}`
}

async function changeSettings($: EngineInterface, fn: (s: VoiceSettings) => VoiceSettings) {
  await update($, settings, fn)
  await $.store.set('settings', await read($, settings))
}

async function stop($: EngineInterface) {
  const run = current
  current = null
  if (run) await run.stream.return(undefined)
  await update($, reading, () => IDLE)
}

// Starts a reading and returns at once; the loop lives on until the helper ends.
async function start($: EngineInterface, blocks: string[]) {
  await stop($)
  const s = await read($, settings)
  const lang = s.lang === 'auto' ? detectLang(blocks.join('\n')) : s.lang
  const id = ++runs
  await update($, reading, () => ({ ...IDLE, sources: blocks, lang }))
  const stream = $.process.spawn({
    argv: ['python3', helper($)],
    input: JSON.stringify({ blocks, voice: voiceFor(s, lang), speed: s.speed }),
  })
  current = { id, stream }

  void (async () => {
    let pending = ''
    let errors = ''
    try {
      for await (const { stream: pipe, text } of stream) {
        if (pipe === 'stderr') {
          errors += text
          continue
        }
        pending += text
        const lines = pending.split('\n')
        pending = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim() || current?.id !== id) continue
          const msg = JSON.parse(line) as { control?: string; items?: Sentence[]; at?: number }
          if (msg.control) {
            current.control = msg.control
          } else if (msg.items) {
            const items = msg.items
            await update($, reading, r => ({ ...r, items }))
          } else if (typeof msg.at === 'number') {
            const at = msg.at
            await update($, reading, r => ({ ...r, at }))
          }
        }
      }
      const ended = await stream.result
      if (ended.code && current?.id === id) {
        $.ui.toast(`Leer en voz: ${errors.trim().split('\n').pop() || `salió con ${ended.code}`}`)
      }
    } catch (err) {
      if (current?.id === id) $.ui.toast(`Leer en voz: ${String(err)}`)
    } finally {
      if (current?.id === id) {
        current = null
        await update($, reading, () => IDLE)
      }
    }
  })()
}

// The nth reply counting back from the newest (1 = the last one).
async function readReply($: EngineInterface, n: number): Promise<string> {
  const all = replies(await $.session.messages())
  const reply = all[n - 1]
  if (!reply) return all.length === 0 ? 'No hay respuestas para leer.' : `Hay ${all.length} respuestas; elegí entre 1 y ${all.length}.`
  await start($, reply)

  return `Leyendo ${n === 1 ? 'la última respuesta' : `la respuesta ${n} desde el final`}…`
}

async function cycleLang($: EngineInterface) {
  await changeSettings($, s => ({
    ...s,
    lang: LANG_CYCLE[(LANG_CYCLE.indexOf(s.lang) + 1) % LANG_CYCLE.length] ?? 'auto',
  }))
}

async function changeSpeed($: EngineInterface, speed: (now: number) => number) {
  await changeSettings($, s => ({
    ...s,
    speed: Math.round(Math.min(2, Math.max(0.5, speed(s.speed))) * 10) / 10,
  }))
  // A reading under way takes it from its next sentence.
  if (current?.control) {
    await $.fs.write(current.control, JSON.stringify({ speed: (await read($, settings)).speed }))
  }
}

function langLabel(lang: VoiceSettings['lang']): string {
  return lang === 'auto' ? 'auto' : lang.toUpperCase()
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const stored = (await $.store.get('settings')) as Partial<VoiceSettings> | undefined
    const config = await $.process.run(['python3', speakPy($), '--get-config'])
    const provider =
      config.exitCode === 0 ? (JSON.parse(config.stdout) as { provider: Provider }).provider : 'system'
    await update($, settings, () => ({
      ...DEFAULTS,
      ...stored,
      voices: { ...DEFAULT_VOICES, ...stored?.voices },
      provider,
    }))

    await $.command.register({
      name: 'read-along',
      description: 'Leer en voz alta una respuesta: /read-along 3 = la tercera desde el final',
      argumentHint: '[n | texto]',
    })
    await $.command.register({
      name: 'read-along-stop',
      description: 'Parar la lectura en voz alta',
      immediate: true,
    })
    await $.command.register({
      name: 'read-along-lang',
      description: 'Idioma de la voz: auto (según el texto), es o en',
      argumentHint: '[auto|es|en]',
      immediate: true,
    })
    await $.command.register({
      name: 'read-along-voice',
      description: 'Ver las voces o elegir la de un idioma',
      argumentHint: '[es|en] [voz]',
    })
    await $.command.register({
      name: 'read-along-speed',
      description: 'Velocidad de lectura, de 0.5 a 2',
      argumentHint: '[n]',
      immediate: true,
    })
    await $.command.register({
      name: 'read-along-auto',
      description: 'Leer cada respuesta al terminar el turno',
      argumentHint: '[on|off]',
      immediate: true,
    })
    await $.command.register({
      name: 'read-along-status',
      description: 'Proveedor, idioma, voces y velocidad de la lectura en voz alta',
    })

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    await stop($)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined && !e.isAborted && (await read($, settings)).autoRead) {
      await readReply($, 1)
    }
    return done
  })

  on('command.run', { command: 'read-along' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === '') return { text: await readReply($, 1) }
    if (/^\d+$/.test(arg)) return { text: await readReply($, Number(arg)) }
    await start($, [arg])

    return { text: 'Leyendo el texto…' }
  })

  on('command.run', { command: 'read-along-stop' }, async $ => {
    await stop($)

    return { text: 'Lectura detenida.' }
  })

  on('command.run', { command: 'read-along-lang' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'auto' || arg === 'es' || arg === 'en') {
      await changeSettings($, s => ({ ...s, lang: arg }))
    } else if (arg === '') {
      await cycleLang($)
    } else {
      return { text: 'Usá /read-along-lang auto, es o en.' }
    }

    return { text: `Idioma: ${langLabel((await read($, settings)).lang)}` }
  })

  on('command.run', { command: 'read-along-voice' }, async ($, e) => {
    const [first = '', ...rest] = e.args.trim().split(/\s+/)
    const s = await read($, settings)
    const lang: Lang | null = first === 'es' || first === 'en' ? first : null
    const voice = (lang ? rest.join(' ') : e.args).trim()

    if (voice) {
      const target = lang ?? voiceLang(voice) ?? (s.lang === 'auto' ? null : s.lang)
      if (!target) return { text: `¿Para qué idioma? /read-along-voice es ${voice}  o  /read-along-voice en ${voice}` }
      await changeSettings($, cur => ({
        ...cur,
        voices: {
          ...cur.voices,
          [cur.provider]: { ...(cur.voices[cur.provider] ?? { es: '', en: '' }), [target]: voice },
        },
      }))
      const preview = target === 'es' ? 'Hola, esta es mi voz.' : 'Hi, this is my voice.'
      await start($, [preview])

      return { text: `Voz para ${target.toUpperCase()} (${s.provider}): ${voice}` }
    }

    const list = await $.process.run(['python3', speakPy($), '--list-voices'])
    if (list.exitCode !== 0) return { text: list.stderr.trim() }
    const { provider, voices } = JSON.parse(list.stdout) as {
      provider: string
      voices: { id: string; label: string }[]
    }
    const isSpanish = (v: { id: string; label: string }) =>
      /\bes[_-]|spanish|^e[fm]_/i.test(`${v.id} ${v.label}`)
    const isEnglish = (v: { id: string; label: string }) =>
      /\ben[_-]|american|british|^[ab][fm]_/i.test(`${v.id} ${v.label}`)
    const row = (v: { id: string; label: string }, l: Lang) =>
      `  ${voiceFor(s, l) === v.id ? '●' : ' '} ${v.id}${v.label === v.id ? '' : `  ${v.label}`}`

    return {
      text: [
        `Voces de ${provider}. ● = la elegida.`,
        '',
        'Español:',
        ...voices.filter(isSpanish).map(v => row(v, 'es')),
        '',
        'Inglés:',
        ...voices.filter(isEnglish).map(v => row(v, 'en')),
        '',
        'Elegir: /read-along-voice es <voz>  ·  /read-along-voice en <voz>',
      ].join('\n'),
    }
  })

  on('command.run', { command: 'read-along-speed' }, async ($, e) => {
    const n = Number(e.args.trim().replace(',', '.'))
    if (e.args.trim() !== '' && Number.isFinite(n)) {
      await changeSpeed($, () => n)
    }

    return { text: `Velocidad: ${(await read($, settings)).speed}x` }
  })

  on('command.run', { command: 'read-along-auto' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    await changeSettings($, s => ({
      ...s,
      autoRead: arg === 'on' ? true : arg === 'off' ? false : !s.autoRead,
    }))
    const isOn = (await read($, settings)).autoRead

    return { text: `Lectura automática: ${isOn ? 'activada (cada respuesta)' : 'desactivada'}` }
  })

  on('command.run', { command: 'read-along-status' }, async $ => {
    const s = await read($, settings)

    return {
      text: [
        `Proveedor: ${s.provider}`,
        `Idioma: ${langLabel(s.lang)}`,
        `Voz ES: ${voiceFor(s, 'es') || '(la del sistema)'}`,
        `Voz EN: ${voiceFor(s, 'en') || '(la del sistema)'}`,
        `Velocidad: ${s.speed}x`,
        `Lectura automática: ${s.autoRead ? 'sí' : 'no'}`,
      ].join('\n'),
    }
  })

  // Each reply block: the speaker on hover; while read, its sentence marked in place.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const r = await read($, reading)
    const { Box, Button } = $.ui.resolve(e)
    const key = `leer-${e.requestId}`
    const block = r.sources.findIndex(src => src.trim() === e.props.text.trim())
    const now = r.items[r.at]

    if (block >= 0 && now?.b === block) {
      const said = r.items.slice(0, r.at + 1).filter(it => it.b === block).map(it => it.s)
      return next({ ...e, props: { ...e.props, text: markSentence(e.props.text, said) } })
    }

    const drawn = await next(e)
    if (e.props.isSummary || e.props.text.trim().length === 0) return drawn
    const text = e.props.text

    return (
      <Box key={key} flexDirection="column">
        {drawn}
        <Box position="absolute" top={0} right={0} display="none" hover={{ display: 'flex' }}>
          <Button key={`${key}-play`} plain label={'\u{1F50A}'} onPress={() => start($, [text])} />
        </Box>
      </Box>
    )
  })

  // Under the prompt: read / stop, and the language, always at hand.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const drawn = await next(e)
    if (e.surface !== 'terminal') return drawn
    const r = await read($, reading)
    const s = await read($, settings)
    const { Box, Button, Text } = $.ui.resolve(e)
    const isReading = r.sources.length > 0

    return (
      <Box gap={2}>
        {drawn}
        <Box gap={1}>
          {isReading ? (
            <Button key="leer-hint-stop" plain dimColor label="■ parar" onPress={() => stop($)} />
          ) : (
            <Button key="leer-hint-play" plain dimColor label={'\u{1F50A} leer'} onPress={() => readReply($, 1)} />
          )}
          <Text dimColor>–</Text>
          <Button key="leer-hint-lang" plain dimColor label={`idioma: ${langLabel(s.lang)}`} onPress={() => cycleLang($)} />
        </Box>
      </Box>
    )
  })

  // While reading: the sentence playing, its language and the controls, above the prompt.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const r = await read($, reading)
    if (e.props.hasSurvey || r.sources.length === 0) return next(e)
    const s = await read($, settings)
    const { Box, Text, Button } = $.ui.resolve(e)
    const now = r.at >= 0 ? r.items[r.at] : undefined
    const lang = r.lang ?? 'es'

    return (
      <Box flexDirection="column">
        <Box gap={1}>
          <Text color="claude">
            {'\u{1F50A} '}
            {now ? `Leyendo ${r.at + 1}/${r.items.length}` : 'Preparando la voz…'}
          </Text>
          <Text dimColor>
            {lang.toUpperCase()} · {voiceFor(s, lang) || 'voz del sistema'} · {s.speed}x
          </Text>
          <Button key="leer-parar" label="Parar" hotkey="s" onPress={() => stop($)} />
          <Button key="leer-lento" label="−" hotkey="1" onPress={() => changeSpeed($, n => n - 0.1)} />
          <Button key="leer-rapido" label="+" hotkey="2" onPress={() => changeSpeed($, n => n + 0.1)} />
        </Box>
        {now && <Text inverse wrap="truncate-end">{now.s}</Text>}
      </Box>
    )
  })
}
