const { Router } = require('express');
const { handleIncomingMessage } = require('../agent');

const router = Router();

router.post('/message', async (req, res) => {
  try {
    const { chatId, messageText, senderName } = req.body;
    if (!chatId || !messageText) {
      return res.status(400).json({ error: 'chatId and messageText required' });
    }

    const mockMsg = {
      from: chatId,
      body: messageText,
      _data: {
        notifyName: senderName || 'Simulator',
        pushname: senderName || 'Simulator',
      },
    };

    await handleIncomingMessage(mockMsg);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
