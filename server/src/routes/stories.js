const express = require('express');
const { supabase } = require('../config/firebase');
const { verifyToken } = require('../middleware/auth');
const router = express.Router();

router.post('/upload', verifyToken, async (req, res) => {
  try {
    const { title, description, mediaData, mediaType, duration } = req.body;
    const userId = req.user.id;

    const base64Data = mediaData.split(',')[1];
    const buffer = Buffer.from(base64Data, 'base64');

    const fileName = `${userId}/${Date.now()}-${title.replace(/\s+/g, '-')}`;
    const { error: storageError } = await supabase.storage
      .from('stories')
      .upload(fileName, buffer, {
        contentType: mediaType,
      });

    if (storageError) {
      return res.status(400).json({ error: storageError.message });
    }

    const { data: { publicUrl } } = supabase.storage
      .from('stories')
      .getPublicUrl(fileName);

    const { data, error } = await supabase
      .from('stories')
      .insert({
        user_id: userId,
        title,
        description,
        media_url: publicUrl,
        media_type: mediaType,
        duration,
        likes: 0,
        is_public: true,
      })
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({
      id: data.id,
      message: 'Story uploaded successfully',
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/public', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || 20);
    const offset = parseInt(req.query.offset || 0);

    const { data, error } = await supabase
      .from('stories')
      .select('*')
      .eq('is_public', true)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({ stories: data });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/my-stories', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const { data, error } = await supabase
      .from('stories')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({ stories: data });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/:storyId/like', verifyToken, async (req, res) => {
  try {
    const { storyId } = req.params;

    const { data: story, error: fetchError } = await supabase
      .from('stories')
      .select('likes')
      .eq('id', storyId)
      .single();

    if (fetchError) {
      return res.status(400).json({ error: fetchError.message });
    }

    const { error } = await supabase
      .from('stories')
      .update({ likes: (story.likes || 0) + 1 })
      .eq('id', storyId);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({ message: 'Liked successfully' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;
