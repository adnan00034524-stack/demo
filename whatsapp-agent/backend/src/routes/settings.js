const { Router } = require('express');
const db = require('../db');

const router = Router();

router.get('/', (req, res) => {
  res.json({ settings: db.getSettings() });
});

router.post('/', (req, res) => {
  const settings = db.saveSettings(req.body);
  res.json({ settings });
});

module.exports = router;
