const { Router } = require('express');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');

const storage = multer.diskStorage({
  destination: path.join(__dirname, '..', '..', 'uploads'),
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
});

const router = Router();

router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const doc = db.addDocument({
      id: uuidv4(),
      filename: req.file.originalname,
      originalType: path.extname(req.file.originalname).slice(1),
      chunkCount: 0,
      status: 'processing',
      uploadedAt: new Date().toISOString(),
    });

    processDocument(doc.id, req.file.path).catch(err => {
      console.error('Document processing error:', err.message);
      db.updateDocument(doc.id, { status: 'error' });
    });

    res.json({ id: doc.id, filename: req.file.originalname, status: 'processing' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/', (req, res) => {
  res.json(db.getDocuments());
});

router.get('/:id', (req, res) => {
  const doc = db.getDocument(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  res.json(doc);
});

router.delete('/:id', async (req, res) => {
  const doc = db.getDocument(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found' });

  if (global.ragClient) {
    try {
      await global.ragClient.deleteByDocId(req.params.id);
    } catch { /* ignore */ }
  }

  db.deleteDocument(req.params.id);
  res.json({ success: true });
});

async function processDocument(docId, filePath) {
  if (!global.documentManager) {
    db.updateDocument(docId, { status: 'error' });
    return;
  }
  try {
    const chunkCount = await global.documentManager.processDocument(docId, filePath);
    db.updateDocument(docId, { status: 'ready', chunkCount });
  } catch (err) {
    console.error('Document processing failed:', err.message);
    db.updateDocument(docId, { status: 'error' });
  }
}

module.exports = router;
