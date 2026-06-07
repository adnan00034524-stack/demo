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
  // Step 1: Convert any audio format to WAV 16kHz mono using ffmpeg
  const wavPath = filePath + '.whisper.wav';
  try {
    execSync(`"${ffmpegPath}" -i "${filePath}" -ar 16000 -ac 1 -f wav "${wavPath}" -y`, {
      stdio: 'pipe',
    });
  } catch (err) {
    console.error('[STT] ffmpeg conversion failed:', err.message);
    throw new Error('Audio conversion failed');
  }

  // Step 2: Read WAV and convert to Float32Array
  let audioData;
  try {
    const buffer = fs.readFileSync(wavPath);
    const wav = new wavefile.WaveFile(buffer);
    wav.toBitDepth('32f');
    wav.toSampleRate(16000);
    audioData = wav.getSamples();
    if (Array.isArray(audioData)) {
      audioData = audioData[0]; // mono: take first channel
    }
  } finally {
    // Cleanup temp WAV file
    try { fs.unlinkSync(wavPath); } catch { /* ignore */ }
  }

  // Step 3: Transcribe using local Whisper model
  const transcriber = await LocalTranscriber.getInstance();
  const result = await transcriber(audioData);
  return result.text || '';
}

module.exports = { transcribeLocal };
