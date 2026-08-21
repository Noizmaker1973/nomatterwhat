const express = require('express');
const { db } = require('../config/firebase');
const { verifyToken } = require('../middleware/auth');
const router = express.Router();

router.post('/start-journey', verifyToken, async (req, res) => {
  try {
    const { sobrietyDate, notes } = req.body;
    const userId = req.user.uid;

    const journeyRef = await db.collection('users').doc(userId).collection('recovery').add({
      sobrietyDate: new Date(sobrietyDate),
      startedAt: new Date(),
      notes,
      milestones: [],
      lastUpdated: new Date(),
    });

    res.json({ 
      id: journeyRef.id, 
      message: 'Recovery journey started successfully' 
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/journey', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const journeySnap = await db
      .collection('users')
      .doc(userId)
      .collection('recovery')
      .orderBy('startedAt', 'desc')
      .limit(1)
      .get();

    if (journeySnap.empty) {
      return res.json({ journey: null });
    }

    const journey = journeySnap.docs[0];
    const data = journey.data();
    const daysClean = Math.floor((new Date() - data.sobrietyDate) / (1000 * 60 * 60 * 24));

    res.json({
      id: journey.id,
      ...data,
      daysClean,
      sobrietyDate: data.sobrietyDate.toISOString(),
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/add-milestone', verifyToken, async (req, res) => {
  try {
    const { journeyId, title, description } = req.body;
    const userId = req.user.uid;

    const journeyRef = db
      .collection('users')
      .doc(userId)
      .collection('recovery')
      .doc(journeyId);

    const milestone = {
      id: Date.now(),
      title,
      description,
      achievedAt: new Date(),
    };

    await journeyRef.update({
      milestones: admin.firestore.FieldValue.arrayUnion(milestone),
      lastUpdated: new Date(),
    });

    res.json({ milestone });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;
