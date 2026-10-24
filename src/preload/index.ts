import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import { EVENTS, type StudioApi } from '../shared/api'

const call =
  <T>(channel: string) =>
  (...args: unknown[]): Promise<T> =>
    ipcRenderer.invoke(channel, ...args)

const listen =
  <T>(channel: string) =>
  (cb: (payload: T) => void): (() => void) => {
    const handler = (_e: IpcRendererEvent, payload: T): void => cb(payload)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  }

const api: StudioApi = {
  projects: {
    list: call('projects:list'),
    create: call('projects:create'),
    get: call('projects:get'),
    save: call('projects:save'),
    remove: call('projects:remove'),
    duplicate: call('projects:duplicate'),
    setLinks: call('projects:setLinks')
  },
  story: {
    script: call('story:script'),
    visuals: call('story:visuals'),
    musicPrompt: call('story:musicPrompt')
  },
  generate: {
    clipImage: call('generate:clipImage'),
    clipVideo: call('generate:clipVideo'),
    clipTts: call('generate:clipTts'),
    characterSheet: call('generate:characterSheet'),
    missingImages: call('generate:missingImages'),
    missingVideos: call('generate:missingVideos'),
    missingTts: call('generate:missingTts'),
    narration: call('generate:narration'),
    syncCaptions: call('generate:syncCaptions'),
    cancel: call('generate:cancel'),
    estimate: call('generate:estimate')
  },
  clips: {
    split: call('clips:split'),
    detachVoice: call('clips:detachVoice'),
    detachVideo: call('clips:detachVideo'),
    detachImage: call('clips:detachImage'),
    detachAllVideos: call('clips:detachAllVideos'),
    detachAllImages: call('clips:detachAllImages'),
    detachAllVoices: call('clips:detachAllVoices')
  },
  assets: {
    setActive: call('assets:setActive'),
    setWords: call('assets:setWords'),
    purgeUnused: call('assets:purgeUnused'),
    pickMusic: call('assets:pickMusic'),
    pickImage: call('assets:pickImage'),
    musicBeats: call('assets:musicBeats')
  },
  imports: {
    clipFile: call('imports:clipFile'),
    batch: call('imports:batch'),
    json: call('imports:json'),
    dropped: call('imports:dropped'),
    pathOf: (file: File) => webUtils.getPathForFile(file)
  },
  settings: {
    get: call('settings:get'),
    set: call('settings:set'),
    keys: call('settings:keys'),
    setKey: call('settings:setKey'),
    setCustom: call('settings:setCustom'),
    clearKey: call('settings:clearKey'),
    revealKey: call('settings:revealKey'),
    testKey: call('settings:testKey'),
    voices: call('settings:voices'),
    testEdge: call('settings:testEdge'),
    setLocalTts: call('settings:setLocalTts')
  },
  models: {
    list: call('models:list')
  },
  exporter: {
    start: call('export:start'),
    defaultFolder: call('export:defaultFolder'),
    pickFolder: call('export:pickFolder'),
    reveal: call('export:reveal')
  },
  app: {
    openExternal: call('app:openExternal'),
    copyText: call('app:copyText'),
    version: call('app:version')
  },
  whisper: {
    status: call('whisper:status'),
    download: call('whisper:download'),
    cancel: call('whisper:cancel'),
    remove: call('whisper:remove'),
    openFolder: call('whisper:openFolder')
  },
  on: {
    whisper: listen(EVENTS.whisper),
    job: listen(EVENTS.job),
    clip: listen(EVENTS.clip),
    character: listen(EVENTS.character),
    asset: listen(EVENTS.asset)
  }
}

contextBridge.exposeInMainWorld('api', api)
