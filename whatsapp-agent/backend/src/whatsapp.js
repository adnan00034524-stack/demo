const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const { clearProfileLocks, killOrphanBrowsers } = require('./driverManager');
const path = require('path');

const STATE = {
  DISCONNECTED: 'DISCONNECTED',
  STARTING: 'STARTING',
  CONNECTING: 'CONNECTING',
  SCAN_QR: 'SCAN_QR',
  CONNECTED: 'CONNECTED',
  RECONNECTING: 'RECONNECTING',
  ERROR: 'ERROR',
};

let client = null;
let currentState = STATE.DISCONNECTED;
let lastEmittedState = null;
let watchdogInterval = null;
let io = null;
let onMessageCallback = null;
let _initializing = false; // guard against concurrent initClient()

function setState(state, extra = {}) {
  currentState = state;
  lastEmittedState = { status: state, ...extra };
  if (io) {
    io.emit('status-update', lastEmittedState);
  }
  console.log('WhatsApp State:', state, extra.qr ? '(QR present)' : '');
}

function startWatchdog() {
  if (watchdogInterval) clearInterval(watchdogInterval);
  let failCount = 0;

  watchdogInterval = setInterval(async () => {
    if (!client) return;

    try {
      const state = await client.getState();
      if (state === 'CONNECTED') {
        failCount = 0;
      } else {
        failCount++;
        if (failCount >= 3) {
          console.log('Watchdog: 3 consecutive failures, reconnecting...');
          setState(STATE.RECONNECTING);
          destroy();
          initClient();
        }
      }
    } catch {
      failCount++;
      if (failCount >= 3) {
        console.log('Watchdog: client state error, reconnecting...');
        setState(STATE.RECONNECTING);
        destroy();
        initClient();
      }
    }
  }, 30000);
}

async function handleQR(qr) {
  console.log('QR event received');
  try {
    const qrDataUrl = await qrcode.toDataURL(qr);
    setState(STATE.SCAN_QR, { qr: qrDataUrl });
    console.log('QR data URL generated and emitted');
  } catch (err) {
    console.error('QR generation error:', err.message);
  }
}

let initRetryTimeout = null;

function initClient() {
  if (_initializing) {
    console.log('initClient: already initializing, skipping');
    return;
  }
  _initializing = true;

  setState(STATE.STARTING);

  try {
    killOrphanBrowsers();
    clearProfileLocks();
  } catch (err) {
    console.warn('initClient: cleanup error:', err.message);
  }

  setState(STATE.CONNECTING);

  client = new Client({
    authStrategy: new LocalAuth({ clientId: 'session' }),
    puppeteer: {
      headless: true,
      executablePath: 'C:\\Users\\adnan\\.cache\\puppeteer\\chrome\\win64-146.0.7680.31\\chrome-win64\\chrome.exe',
      args: [
        '--no-first-run',
        '--disable-blink-features=AutomationControlled',
        '--disable-extensions',
        '--no-default-browser-check',
      ],
      defaultViewport: null,
    },
  });

  client.on('qr', handleQR);

  client.on('loading_screen', (percent, message) => {
    console.log(`WhatsApp loading: ${percent}% - ${message}`);
  });

  client.on('authenticated', () => {
    console.log('WhatsApp authenticated');
  });

  client.on('auth_failure', (msg) => {
    console.error('WhatsApp auth failure:', msg);
    setState(STATE.ERROR, { error: 'Auth failure: ' + msg });
  });

  client.on('ready', () => {
    console.log('WhatsApp ready');
    setState(STATE.CONNECTED);
    startWatchdog();
    _initializing = false;
  });

  client.on('change_state', (state) => {
    console.log('WhatsApp connection state change:', state);
  });

  client.on('message', async (msg) => {
    if (msg.fromMe) return;
    if (onMessageCallback) {
      try {
        await onMessageCallback(msg);
      } catch (err) {
        console.error('Message handler error:', err.message);
      }
    }
  });

  client.on('disconnected', (reason) => {
    console.log('WhatsApp disconnected:', reason);
    setState(STATE.DISCONNECTED);
    destroy();
    setTimeout(() => initClient(), 5000);
  });

  // Init timeout: if QR doesn't appear in 20s, restart
  const initTimeout = setTimeout(() => {
    const state = getState();
    if (state === STATE.CONNECTING || state === STATE.STARTING) {
      console.log('Init timeout: restarting...');
      destroy();
      initClient();
    }
  }, 25000);

  client.initialize().then(() => {
    clearTimeout(initTimeout);
    console.log('Client initialize completed');
  }).catch(err => {
    clearTimeout(initTimeout);
    console.error('Client init error:', err.message);
    setState(STATE.ERROR, { error: err.message });
    // Don't retry immediately on TargetClosedError (Chrome was killed)
    const isTargetClosed = err.message?.includes('Target closed') || err.name?.includes('TargetCloseError');
    const retryDelay = isTargetClosed ? 5000 : 3000;
    if (initRetryTimeout) clearTimeout(initRetryTimeout);
    initRetryTimeout = setTimeout(() => {
      _initializing = false;
      if (getState() !== STATE.CONNECTED) {
        console.log('Retrying init...');
        initClient();
      }
    }, retryDelay);
  }).finally(() => {
    _initializing = false;
  });
}

function destroy() {
  if (watchdogInterval) {
    clearInterval(watchdogInterval);
    watchdogInterval = null;
  }
  if (initRetryTimeout) {
    clearTimeout(initRetryTimeout);
    initRetryTimeout = null;
  }
  if (client) {
    try {
      client.destroy();
    } catch { /* ignore */ }
    client = null;
  }
}

function getState() {
  return currentState;
}

function setSocketIO(socketIO) {
  io = socketIO;
}

function onMessage(callback) {
  onMessageCallback = callback;
}

async function sendMessage(to, text) {
  if (!client) throw new Error('Client not initialized');
  await client.sendMessage(to, text);
}

module.exports = {
  initClient,
  destroy,
  getState,
  lastEmittedState: () => lastEmittedState,
  setSocketIO,
  onMessage,
  sendMessage,
  STATE,
};
