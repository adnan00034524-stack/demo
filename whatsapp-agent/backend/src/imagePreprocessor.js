const Jimp = require('jimp');

async function preprocessImage(input) {
  try {
    const image = await Jimp.read(input);
    const processed = await image
      .grayscale()
      .contrast(0.35)
      .normalize()
      .quality(90)
      .getBufferAsync(Jimp.MIME_PNG);
    const label = typeof input === 'string' ? input : `buffer(${Buffer.isBuffer(input) ? input.length : '?'} bytes)`;
    console.log(`[IMG-PRE] Preprocessed ${label}`);
    return processed;
  } catch (err) {
    console.warn('[IMG-PRE] Preprocessing failed, using original:', err.message);
    return null;
  }
}

module.exports = { preprocessImage };
