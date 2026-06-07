const { Router } = require('express');
const fs = require('fs');
const path = require('path');
const whatsapp = require('../whatsapp');

const router = Router();

router.post('/disconnect', (req, res) => {
  try {
    whatsapp.destroy();
    res.json({ success: true, status: 'DISCONNECTED' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/remove', (req, res) => {
  try {
    whatsapp.destroy();
    const authDir = path.join(__dirname, '..', '..', '.wwebjs_auth');
    if (fs.existsSync(authDir)) {
      fs.rmSync(authDir, { recursive: true, force: true });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
