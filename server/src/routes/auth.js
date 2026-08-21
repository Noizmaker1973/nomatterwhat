const express = require('express');
const { auth, db } = require('../config/firebase');
const router = express.Router();

router.post('/register', async (req, res) => {
  try {
    const { email, password, displayName, recoveryType } = req.body;

    const userRecord = await auth.createUser({
      email,
      password,
      displayName,
    });

    await db.collection('users').doc(userRecord.uid).set({
      email,
      displayName,
      recoveryType, // 'AA', 'NA', or 'Both'
      sobrietyDate: new Date(),
      createdAt: new Date(),
      preferences: {
        sponsorType: 'both', // 'human', 'ai', or 'both'
      },
    });

    res.json({ uid: userRecord.uid, email: userRecord.email });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/login', async (req, res) => {
  res.json({ message: 'Use Firebase client SDK for login' });
});

module.exports = router;
