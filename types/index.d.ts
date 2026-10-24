export type Lang = 'es' | 'en'

export type Provider = 'system' | 'kokoro' | 'speechify' | 'elevenlabs' | 'openai' | 'command'

export type Sentence = { b: number; p: number; s: string }

export type Reading = {
  /** The markdown of each block being read: matched against an AssistantMessage's text. */
  sources: string[]
  items: Sentence[]
  /** Index of the sentence playing; -1 while the voice loads. */
  at: number
  /** Language the reading was spoken in; null when idle. */
  lang: Lang | null
}

export type VoiceSettings = {
  /** `auto` picks per reply from its words. */
  lang: 'auto' | Lang
  /** Read every reply when its turn ends. */
  autoRead: boolean
  speed: number
  /** speak.py's provider (`kokoro`, `system`, ...). */
  provider: Provider
  /** The voice per language for every provider used so far. */
  voices: Partial<Record<Provider, Record<Lang, string>>>
}

declare module 'claude-code' {
  interface PluginState {
    'read-along': { reading: Shaped<Reading>; settings: Shaped<VoiceSettings> }
  }
}
