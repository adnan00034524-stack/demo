const { Router } = require('express');
const db = require('../db');

const router = Router();

router.get('/', (req, res) => {
  res.json(db.getFaqs());
});

router.post('/', (req, res) => {
  const faqs = db.saveFaqs(req.body);
  res.json(faqs);
});

module.exports = router;
