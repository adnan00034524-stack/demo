const fs = require('fs');
const { execSync } = require('child_process');
const wavefile = require('wavefile');
const ffmpegPath = require('ffmpeg-static');

class LocalTranscriber {
  static instance = null;

  static async getInstance() {
    if (this.instance === null) {
      const { pipeline } = await import('@huggingface/transformers');
      console.log('[STT] Loading Whisper model (first time downloads ~460MB)...');
      this.instance = await pipeline('automatic-speech-recognition', 'Xenova/whisper-base');
      console.log('[STT] Whisper model loaded');
    }
    return this.instance;
  }
}

async function transcribeLocal(filePath) {
  // Check file exists and is not empty
  try {
    const stat = fs.statSync(filePath);
    if (stat.size === 0) {
      console.error('[STT] File is empty');
      return '';
    }
    if (stat.size > 50 * 1024 * 1024) {
      console.error('[STT] File too large (>50MB), skipping');
      return '';
    }
  } catch (err) {
    console.error('[STT] File stat failed:', err.message);
    return '';
  }

  // Step 1: Convert any audio format to WAV 16kHz mono using ffmpeg
  const wavPath = filePath + '.whisper.wav';
  try {
    execSync(`"${ffmpegPath}" -i "${filePath}" -ar 16000 -ac 1 -f wav "${wavPath}" -y`, {
      stdio: 'pipe',
      timeout: 30000, // 30s max for conversion
    });
  } catch (err) {
    console.error('[STT] ffmpeg conversion failed:', err.message);
    // Fallback: try reading the file directly as WAV (if already wav)
    try {
      const fallbackBuffer = fs.readFileSync(filePath);
      const wav = new wavefile.WaveFile(fallbackBuffer);
      return await transcribeBuffer(wav);
    } catch (fallbackErr) {
      console.error('[STT] Direct read fallback also failed:', fallbackErr.message);
      return '';
    }
  }

  // Step 2: Read WAV and convert to Float32Array
  let audioData;
  try {
    const buffer = fs.readFileSync(wavPath);
    const wav = new wavefile.WaveFile(buffer);
    audioData = extractAudioData(wav);
  } finally {
    // Cleanup temp WAV file
    try { fs.unlinkSync(wavPath); } catch { /* ignore */ }
  }

  // Step 3: Transcribe using local Whisper model
  const transcriber = await LocalTranscriber.getInstance();
  try {
    const result = await transcriber(audioData);
    return result.text || '';
  } catch (err) {
    console.error('[STT] Whisper transcription failed:', err.message);
    return '';
  }
}

function extractAudioData(wav) {
  wav.toBitDepth('32f');
  wav.toSampleRate(16000);
  let samples = wav.getSamples();
  if (Array.isArray(samples)) {
    samples = samples[0]; // mono: take first channel
  }
  return samples;
}

async function transcribeBuffer(wav) {
  const data = extractAudioData(wav);
  const transcriber = await LocalTranscriber.getInstance();
  const result = await transcriber(data);
  return result.text || '';
}

module.exports = { transcribeLocal };
