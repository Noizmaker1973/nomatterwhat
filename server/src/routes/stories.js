const express = require('express');
const { db, storage } = require('../config/firebase');
const { verifyToken } = require('../middleware/auth');
const router = express.Router();

router.post('/upload', verifyToken, async (req, res) => {
  try {
    const { title, description, mediaData, mediaType, duration } = req.body;
    const userId = req.user.uid;

    const bucket = storage.bucket();
    const fileName = `stories/${userId}/${Date.now()}-${title.replace(/\s+/g, '-')}`;
    const file = bucket.file(fileName);

    const base64Data = mediaData.split(',')[1];
    const buffer = Buffer.from(base64Data, 'base64');

    await file.save(buffer, {
      metadata: {
        contentType: mediaType,
      },
    });

    const [url] = await file.getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + 15 * 24 * 60 * 60 * 1000, // 15 days
    });

    const storyRef = await db.collection('stories').add({
      userId,
      title,
      description,
      mediaUrl: url,
      mediaType,
      duration,
      createdAt: new Date(),
      likes: 0,
      comments: [],
      isPublic: true,
    });

    res.json({
      id: storyRef.id,
      message: 'Story uploaded successfully',
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/public', async (req, res) => {
  try {
    const limit = req.query.limit || 20;
    const offset = req.query.offset || 0;

    const storiesSnap = await db
      .collection('stories')
      .where('isPublic', '==', true)
      .orderBy('createdAt', 'desc')
      .offset(parseInt(offset))
      .limit(parseInt(limit))
      .get();

    const stories = storiesSnap.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      createdAt: doc.data().createdAt?.toISOString(),
    }));

    res.json({ stories });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/my-stories', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;

    const storiesSnap = await db
      .collection('stories')
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .get();

    const stories = storiesSnap.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      createdAt: doc.data().createdAt?.toISOString(),
    }));

    res.json({ stories });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/:storyId/like', verifyToken, async (req, res) => {
  try {
    const { storyId } = req.params;
    const storyRef = db.collection('stories').doc(storyId);

    await storyRef.update({
      likes: admin.firestore.FieldValue.increment(1),
    });

    res.json({ message: 'Liked successfully' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;
