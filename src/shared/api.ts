import type {
  ApiProvider,
  AspectRatio,
  AppSettings,
  Asset,
  CharacterPatchEvent,
  ClipPatchEvent,
  CreditEstimate,
  WhisperStatus,
  WordTiming,
  ExportOptions,
  ImportResult,
  LinkRestore,
  Job,
  KeyStatus,
  KeyTestResult,
  ModelList,
  ModelSource,
  MusicPrompt,
  NewProjectInput,
  ProjectBundle,
  ProjectSnapshot,
  ProjectSummary,
  TtsOverride,
  TtsProvider,
  VoiceOption
} from './types'

/** The typed surface the preload script exposes as `window.api`. */
export interface StudioApi {
  projects: {
    list(): Promise<ProjectSummary[]>
    create(input: NewProjectInput): Promise<ProjectBundle>
    get(id: string): Promise<ProjectBundle>
    save(snapshot: ProjectSnapshot): Promise<{ updatedAt: number }>
    remove(id: string): Promise<void>
    duplicate(id: string): Promise<ProjectSummary>
    /** Puts asset links back after undo or redo (the save never touches them). */
    setLinks(projectId: string, links: LinkRestore): Promise<void>
  }
  story: {
    /** Idea → scene-by-scene script (story and voice-over). */
    script(projectId: string): Promise<ProjectBundle>
    /** Script → one image plan per scene; "missing" skips scenes whose plan still matches their story. */
    visuals(projectId: string, mode: 'missing' | 'all'): Promise<ProjectBundle>
    /** A background-music prompt that fits the finished script, for use in Suno or another music AI. */
    musicPrompt(projectId: string): Promise<MusicPrompt>
  }
  generate: {
    clipImage(clipId: string): Promise<Job>
    clipVideo(clipId: string): Promise<Job>
    /** Voices one clip; `override` picks another narrator service or voice for just this clip. */
    clipTts(clipId: string, override?: TtsOverride): Promise<Job>
    characterSheet(characterId: string): Promise<Job>
    missingImages(projectId: string): Promise<Job[]>
    /** An AI video for every clip that has an image but no video yet. */
    missingVideos(projectId: string): Promise<Job[]>
    missingTts(projectId: string): Promise<Job[]>
    /** Voices scenes in one continuous take and cuts it per scene: those without a voice, or all of them. */
    narration(projectId: string, mode: 'missing' | 'all'): Promise<Job>
    /** Re-times caption words of voiced scenes against the audio with the local Whisper model. */
    syncCaptions(projectId: string, mode?: 'stale' | 'all'): Promise<Job>
    cancel(jobId: string): Promise<void>
    /** Credits for one image, or one video of about `seconds`, with this model. Null without a working key. */
    estimate(kind: 'image' | 'video', modelId: string, aspect: AspectRatio, seconds?: number, resolution?: string | null): Promise<CreditEstimate | null>
  }
  clips: {
    /** Splits a clip at `atMs` into two clips (picture, voice and narration divided at the nearest pause). */
    split(clipId: string, atMs: number): Promise<ProjectBundle>
    /** Takes the voice off a clip. */
    detachVoice(clipId: string): Promise<void>
    /** Takes the video off a clip: it goes back to its picture with a camera move. */
    detachVideo(clipId: string): Promise<void>
    /** Takes the video off every clip of the project. The files stay until purgeVideos. */
    detachAllVideos(projectId: string): Promise<{ bundle: ProjectBundle; count: number }>
  }
  assets: {
    setActive(clipId: string, assetId: string): Promise<void>
    /** Caption words of a voice clip, after the text was fixed by hand. */
    setWords(assetId: string, words: WordTiming[]): Promise<Asset>
    /** Deletes the files of videos no clip uses, to free disk space. */
    purgeVideos(projectId: string): Promise<{ bundle: ProjectBundle; count: number; bytes: number }>
    pickMusic(projectId: string): Promise<Asset | null>
    /** A logo or watermark image for an overlay. */
    pickImage(projectId: string): Promise<Asset | null>
    /** Rough beat times of a music asset in seconds, for cutting pictures on the music. */
    musicBeats(assetId: string): Promise<number[]>
  }
  imports: {
    /** A picture or a recorded voice from disk for one clip. False when the dialog was closed. */
    clipFile(clipId: string, kind: 'image' | 'audio'): Promise<boolean>
    /** Many pictures or voices at once, matched to scenes by the number in the file name or in order. */
    batch(projectId: string, kind: 'image' | 'audio'): Promise<ImportResult | null>
    /** A JSON file listing per scene the picture or voice file, narration, prompt and narrator voice. */
    json(projectId: string, kind: 'image' | 'audio'): Promise<ImportResult | null>
    /** Files dropped on a clip: pictures and voices go to that clip, then the clips after it, in name order. */
    dropped(clipId: string, paths: string[]): Promise<ImportResult>
    /** The disk path of a file dropped into the window (Electron no longer puts it on File). */
    pathOf(file: File): string
  }
  settings: {
    get(): Promise<AppSettings>
    set(patch: Partial<AppSettings>): Promise<AppSettings>
    keys(): Promise<KeyStatus[]>
    setKey(provider: ApiProvider, key: string): Promise<KeyTestResult>
    /** Saves an OpenAI-compatible endpoint; the key is optional for local servers. */
    setCustom(baseUrl: string, key: string): Promise<KeyTestResult>
    clearKey(provider: ApiProvider): Promise<void>
    /** The full stored key, only for the "show key" button. */
    revealKey(provider: ApiProvider): Promise<string | null>
    testKey(provider: ApiProvider): Promise<KeyTestResult>
    /** Narrator voices of a service; Edge lists the project's language first. */
    voices(provider: TtsProvider, language?: string): Promise<VoiceOption[]>
    /** Speaks a short sample through the free Edge voice service, to show it answers from this computer. */
    testEdge(): Promise<KeyTestResult>
    /** Saves the address of the local voice server (Voicebox or another voice studio) and checks that it answers. */
    setLocalTts(url: string): Promise<KeyTestResult>
  }
  models: {
    /** Live model list from the provider. Served from cache unless `refresh` is set or the cache is stale. */
    list(source: ModelSource, refresh?: boolean): Promise<ModelList>
  }
  exporter: {
    start(projectId: string, options: ExportOptions): Promise<Job>
    defaultFolder(): Promise<string>
    pickFolder(): Promise<string | null>
    reveal(path: string): Promise<void>
  }
  app: {
    openExternal(url: string): Promise<void>
    copyText(text: string): Promise<void>
    version(): Promise<string>
  }
  whisper: {
    status(): Promise<WhisperStatus>
    download(): Promise<void>
    cancel(): Promise<void>
    remove(): Promise<void>
    openFolder(): Promise<void>
  }
  on: {
    whisper(cb: (status: WhisperStatus) => void): () => void
    job(cb: (job: Job) => void): () => void
    clip(cb: (e: ClipPatchEvent) => void): () => void
    character(cb: (e: CharacterPatchEvent) => void): () => void
    asset(cb: (asset: Asset) => void): () => void
  }
}

export const EVENTS = {
  job: 'event:job',
  clip: 'event:clip',
  character: 'event:character',
  asset: 'event:asset',
  whisper: 'event:whisper'
} as const
