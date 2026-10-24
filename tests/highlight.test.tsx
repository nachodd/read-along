import { expect, test } from 'claude-code/testing'

const MESSAGE = {
  plugin: 'leer-en-voz',
  component: 'AssistantMessage',
  requestId: 'msg-1',
  props: { text: 'Hola. Chau.', isFirstOfReply: true },
} as const

const READING = {
  sources: ['Otro bloque.', 'Hola. Chau.'],
  items: [
    { b: 0, p: 0, s: 'Otro bloque.' },
    { b: 1, p: 0, s: 'Hola.' },
    { b: 1, p: 0, s: 'Chau.' },
  ],
  at: 2,
  lang: 'es',
}

test('the sentence being read is marked in the reply, its markdown kept', async ($, on) => {
  on('state.get', () => ({ value: { value: { shape: 'reading-2', value: READING }, version: 1 } }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{(e.props as { text: string }).text}</Text>
  })

  const ui = await $.ui.mount({ ...MESSAGE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('Hola. \x60Chau.\x60')
  await ui.unmount()
})

test('a sentence with markup of its own gets a marker, not a wrap', async ($, on) => {
  const text = '## Título\n\nUna frase con **negrita** y [link](https://x.y).\n\n- Otra frase.'
  const items = [
    { b: 0, p: 0, s: 'Título' },
    { b: 0, p: 2, s: 'Una frase con negrita y link.' },
    { b: 0, p: 4, s: 'Otra frase.' },
  ]
  const at = (n: number) => ({ shape: 'reading-2', value: { sources: [text], items, at: n, lang: 'es' } })
  let now = 1
  on('state.get', () => ({ value: { value: at(now), version: now } }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{(e.props as { text: string }).text}</Text>
  })

  const message = { ...MESSAGE, props: { text, isFirstOfReply: true }, surface: 'terminal' } as const
  let ui = await $.ui.mount(message)
  expect((await ui.find({ type: 'Text' }))?.text).toBe(
    '## Título\n\n\u25B8 Una frase con **negrita** y [link](https://x.y).\n\n- Otra frase.',
  )
  await ui.unmount()

  now = 2
  ui = await $.ui.mount(message)
  expect((await ui.find({ type: 'Text' }))?.text).toBe(
    '## Título\n\nUna frase con **negrita** y [link](https://x.y).\n\n- \x60Otra frase.\x60',
  )
  await ui.unmount()
})

test('another block keeps the engine drawing and gets the speaker', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })

  const ui = await $.ui.mount({ ...MESSAGE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  expect(await ui.find({ type: 'Button', key: 'leer-msg-1-play' })).toBeTruthy()
  await ui.unmount()
})

test('under the prompt: the engine hint, then read and language buttons', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>? for shortcuts</Text>
  })

  const ui = await $.ui.mount({
    plugin: 'leer-en-voz',
    component: 'PromptHint',
    props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
    surface: 'terminal',
  })
  expect(await ui.find({ type: 'Text', text: /shortcuts/ })).toBeTruthy()
  expect(await ui.find({ type: 'Button', key: 'leer-hint-play' })).toBeTruthy()
  expect((await ui.find({ type: 'Button', key: 'leer-hint-lang' }))?.text).toBe('idioma: auto')
  await ui.unmount()
})
