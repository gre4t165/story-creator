import { existsSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, shell } from 'electron'
import { closeDb, getDb } from './db'
import { attachDevHarness, prepareHarness } from './devharness'
import { resumeJobs } from './generation'
import { registerIpc } from './ipc'
import { handleStudioProtocol, registerSchemes } from './protocol'
import { warmUpEncryption } from './secrets'

/**
 * The app used to be called "Bang Story", and before that "Studio Cerita". Its data folder (projects,
 * database, saved keys) moves to the new name once, from the newest old name that has a database. If the old
 * folder is busy, for example while an old build still runs, it is used as is.
 */
function useDataFolder(): void {
  if (!app.isPackaged && process.env.STUDIO_USER_DATA) return app.setPath('userData', process.env.STUDIO_USER_DATA)
  const appData = app.getPath('appData')
  const current = join(appData, 'Story Creator')
  const legacy = ['Bang Story', 'Studio Cerita'].map((n) => join(appData, n)).find((dir) => existsSync(join(dir, 'studio.db')))
  if (!existsSync(join(current, 'studio.db')) && legacy) {
    try {
      // Electron may already have made an empty folder under the new name; the move needs it gone.
      if (existsSync(current)) rmSync(current, { recursive: true })
      renameSync(legacy, current)
    } catch {
      return app.setPath('userData', legacy)
    }
  }
  app.setPath('userData', current)
}

useDataFolder()
prepareHarness()
// Windows hands videos to hardware overlays that snap their size and position to whole pixels, so a slow
// camera move over a video trembles while the same move over a still is smooth. Draw videos like images.
app.commandLine.appendSwitch('disable-direct-composition-video-overlays')

registerSchemes()

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1180,
    minHeight: 720,
    show: false,
    backgroundColor: '#FAF7F2',
    autoHideMenuBar: true,
    title: 'Story Creator',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.once('ready-to-show', () => win.show())
  attachDevHarness(win)

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(process.env['ELECTRON_RENDERER_URL'] ?? 'file://')) e.preventDefault()
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

const single = app.requestSingleInstanceLock()
if (!single) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const w = BrowserWindow.getAllWindows()[0]
    if (w) {
      if (w.isMinimized()) w.restore()
      w.focus()
    }
  })

  void app.whenReady().then(() => {
    app.setAppUserModelId('id.bangtutorial.bangstory')
    warmUpEncryption()
    getDb()
    handleStudioProtocol()
    registerIpc()
    createWindow()
    resumeJobs()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('will-quit', () => closeDb())
}
