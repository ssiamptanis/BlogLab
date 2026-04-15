'use strict'

const { app, BrowserWindow, Menu, shell, dialog, ipcMain } = require('electron')
const { autoUpdater } = require('electron-updater')
const { spawn }  = require('child_process')
const path       = require('path')
const http       = require('http')
const net        = require('net')
const fs         = require('fs')

// ── Auto-updater ──────────────────────────────────────────────────────────────

function setupAutoUpdater() {
  if (!app.isPackaged) return // skip in dev

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => {
    mainWindow?.webContents.send('update-status', {
      type: 'downloading',
      version: info.version,
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    mainWindow?.webContents.send('update-status', {
      type: 'ready',
      version: info.version,
    })
  })

  autoUpdater.on('error', (err) => {
    console.error('Auto-updater error:', err.message)
  })

  // Check on launch, then every 4 hours
  autoUpdater.checkForUpdates()
  setInterval(() => autoUpdater.checkForUpdates(), 4 * 60 * 60 * 1000)
}

// Allow renderer to trigger install-and-relaunch
ipcMain.on('install-update', () => {
  autoUpdater.quitAndInstall(false, true)
})

let mainWindow   = null
let flaskProcess = null
let flaskPort    = 5001

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Find a free TCP port starting at `preferred` */
function findPort(preferred) {
  return new Promise((resolve) => {
    const srv = net.createServer()
    srv.listen(preferred, '127.0.0.1', () => {
      const p = srv.address().port
      srv.close(() => resolve(p))
    })
    srv.on('error', () => resolve(findPort(preferred + 1)))
  })
}

/** Poll until Flask responds or timeout */
function waitForFlask(port, maxMs = 15000) {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const check = () => {
      http.get(`http://127.0.0.1:${port}/api/templates`, (res) => {
        res.resume()
        resolve()
      }).on('error', () => {
        if (Date.now() - started > maxMs) {
          reject(new Error('Server did not start in time'))
        } else {
          setTimeout(check, 400)
        }
      })
    }
    setTimeout(check, 600) // give Python a head-start
  })
}

/** Resolve the correct Python executable (dev mode only) */
function findPython() {
  const candidates = [
    'python3',
    'python',
    '/usr/bin/python3',
    '/usr/local/bin/python3',
    '/opt/homebrew/bin/python3',
  ]
  for (const p of candidates) {
    try {
      const { execFileSync } = require('child_process')
      execFileSync(p, ['-c', 'import flask, reportlab'], { stdio: 'ignore' })
      return p
    } catch (_) {}
  }
  return candidates[0]
}

// ── Flask process ─────────────────────────────────────────────────────────────

function startFlask(port) {
  const root = app.isPackaged
    ? process.resourcesPath
    : path.join(__dirname, '..')

  // In production use the bundled PyInstaller binary; in dev use python3
  let cmd, args
  if (app.isPackaged) {
    cmd  = path.join(process.resourcesPath, 'abx-server')
    args = []
  } else {
    cmd  = findPython()
    args = [path.join(root, 'server.py')]
  }

  console.log(`Starting Flask: ${cmd} on port ${port}`)

  flaskProcess = spawn(cmd, args, {
    cwd: root,
    env: { ...process.env, FLASK_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  flaskProcess.stdout.on('data', d => process.stdout.write(`[Flask] ${d}`))
  flaskProcess.stderr.on('data', d => process.stderr.write(`[Flask] ${d}`))

  flaskProcess.on('error', (err) => {
    console.error('Flask process error:', err.message)
  })

  flaskProcess.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`Flask exited with code ${code}`)
    }
  })
}

function stopFlask() {
  if (flaskProcess) {
    flaskProcess.kill('SIGTERM')
    flaskProcess = null
  }
}

// ── Native menu ───────────────────────────────────────────────────────────────

function buildMenu() {
  const isMac = process.platform === 'darwin'
  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Template',
          accelerator: 'CmdOrCtrl+N',
          click: () => mainWindow?.webContents.executeJavaScript(`
            if(window._navigate) window._navigate('builder/'); else location.hash='#/builder'
          `),
        },
        {
          label: 'Go to Dashboard',
          accelerator: 'CmdOrCtrl+D',
          click: () => mainWindow?.webContents.executeJavaScript(`location.hash='#/'`),
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(!app.isPackaged ? [
          { type: 'separator' },
          { role: 'toggleDevTools' },
        ] : []),
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac ? [
          { type: 'separator' },
          { role: 'front' },
        ] : [{ role: 'close' }]),
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// ── Loading window ────────────────────────────────────────────────────────────

function showLoadingWindow() {
  const win = new BrowserWindow({
    width: 360,
    height: 240,
    frame: false,
    resizable: false,
    center: true,
    webPreferences: { nodeIntegration: false },
    backgroundColor: '#000000',
  })

  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
    <!DOCTYPE html>
    <html>
    <head>
    <style>
      * { margin:0; padding:0; box-sizing:border-box; }
      body {
        background: #000;
        color: #fff;
        font-family: -apple-system, sans-serif;
        height: 100vh;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 20px;
        user-select: none;
        -webkit-app-region: drag;
      }
      svg { display: block; }
      .label {
        font-size: 13px;
        font-weight: 600;
        color: #7989A6;
        letter-spacing: 0.04em;
      }
      .dot {
        display: inline-block;
        animation: blink 1.4s infinite;
      }
      .dot:nth-child(2) { animation-delay: 0.2s; }
      .dot:nth-child(3) { animation-delay: 0.4s; }
      @keyframes blink {
        0%, 80%, 100% { opacity: 0; }
        40% { opacity: 1; }
      }
      .bar {
        width: 200px;
        height: 2px;
        background: #2A3447;
        border-radius: 2px;
        overflow: hidden;
      }
      .bar-fill {
        height: 100%;
        background: #FF0077;
        border-radius: 2px;
        animation: load 2s ease-in-out infinite;
      }
      @keyframes load {
        0%   { width: 0%; }
        50%  { width: 70%; }
        100% { width: 100%; }
      }
    </style>
    </head>
    <body>
      <svg width="72" height="22" viewBox="0 0 264 81" fill="none">
        <path fill-rule="evenodd" clip-rule="evenodd" d="M263.42 61.5C263.42 49.5 257.84 43.9 245.81 43.9C233.78 43.9 228.2 49.5 228.2 61.5C228.2 73.5 233.78 79.1 245.81 79.1C257.84 79.1 263.42 73.5 263.42 61.5Z" fill="#FF0077"/>
        <path fill-rule="evenodd" clip-rule="evenodd" d="M202 78.7H219.5V1.7H202V78.7Z" fill="white"/>
        <path fill-rule="evenodd" clip-rule="evenodd" d="M170.6 78.7H150.6L135.7 27.3L120.7 78.7H100.8L77 1.7H96.7L110.9 54L125.6 1.7H145.9L161 54.1L175.1 1.7H194.5L170.6 78.7Z" fill="white"/>
        <path fill-rule="evenodd" clip-rule="evenodd" d="M37.3 80.4C26 80.4 16.9 76.8 10.1 69.6C3.4 62.4 0 52.6 0 40.5C0 28.5 3.7 18.7 10.9 11.3C18.2 3.8 27.8 0 39.5 0C54.7 0 66.9 6.8 73.7 19.2L61.3 30.96L60.4 29.5C55.2 21.6 48.2 17.5 39.5 17.5C32.9 17.5 27.6 19.6 23.8 23.7C19.8 27.9 17.9 33.4 17.9 40.4C17.9 47.3 19.8 52.8 23.5 56.7C27.2 60.7 32.3 62.7 38.7 62.7C46 62.7 52.6 59.2 57.3 52.7H39.9V36.1H76.6V78.9H61.9V69.2C59.1 72.6 55.6 75.4 51.7 77.2C47.3 79.3 42.5 80.4 37.3 80.4Z" fill="white"/>
      </svg>
      <div class="bar"><div class="bar-fill"></div></div>
      <div class="label">Starting ABX PDF Builder<span class="dot">.</span><span class="dot">.</span><span class="dot">.</span></div>
    </body>
    </html>
  `)}`)

  return win
}

// ── Main window ───────────────────────────────────────────────────────────────

const DEV_SERVER = 'http://localhost:5173'

function createMainWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#F7FAFF',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
    show: false,
  })

  // Dev: load Vite dev server (hot reload); Prod: load Flask-served dist
  const url = app.isPackaged ? `http://127.0.0.1:${port}` : DEV_SERVER
  mainWindow.loadURL(url)

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
    if (!app.isPackaged) mainWindow.webContents.openDevTools({ mode: 'detach' })
  })

  mainWindow.on('closed', () => { mainWindow = null })

  // Open external links in the system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url)
    return { action: 'deny' }
  })
}

// ── PDF save handler ──────────────────────────────────────────────────────────

ipcMain.handle('save-pdf', async (event, { base64, filename }) => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Save PDF',
    defaultPath: filename,
    filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
  })
  if (canceled || !filePath) return { canceled: true }
  fs.writeFileSync(filePath, Buffer.from(base64, 'base64'))
  shell.showItemInFolder(filePath)
  return { filePath }
})


// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  buildMenu()

  const loadingWin = showLoadingWindow()

  try {
    flaskPort = await findPort(5001)
    startFlask(flaskPort)
    await waitForFlask(flaskPort)

    createMainWindow(flaskPort)
    loadingWin.close()
    setupAutoUpdater()
  } catch (err) {
    console.error('Startup failed:', err)
    loadingWin.close()
    dialog.showErrorBox(
      'Startup failed',
      `ABX PDF Builder could not start.\n\n${err.message}\n\nMake sure Python 3 is installed with Flask and ReportLab.`
    )
    app.quit()
  }
})

app.on('window-all-closed', () => {
  stopFlask()
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (!mainWindow && flaskPort) createMainWindow(flaskPort)
})

app.on('before-quit', stopFlask)
