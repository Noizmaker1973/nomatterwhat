const express = require('express');
const { supabase } = require('../config/firebase');
const { verifyToken } = require('../middleware/auth');
const router = express.Router();

router.post('/start-journey', verifyToken, async (req, res) => {
  try {
    const { sobrietyDate, notes } = req.body;
    const userId = req.user.id;

    const { data, error } = await supabase
      .from('recovery_journeys')
      .insert({
        user_id: userId,
        sobriety_date: sobrietyDate,
        notes,
        milestones: [],
      })
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({
      id: data.id,
      message: 'Recovery journey started successfully'
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/journey', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const { data, error } = await supabase
      .from('recovery_journeys')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') {
      return res.status(400).json({ error: error.message });
    }

    if (!data) {
      return res.json({ journey: null });
    }

    const daysClean = Math.floor(
      (new Date() - new Date(data.sobriety_date)) / (1000 * 60 * 60 * 24)
    );

    res.json({
      id: data.id,
      ...data,
      daysClean,
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/add-milestone', verifyToken, async (req, res) => {
  try {
    const { journeyId, title, description } = req.body;
    const userId = req.user.id;

    const { data: journey, error: fetchError } = await supabase
      .from('recovery_journeys')
      .select('milestones')
      .eq('id', journeyId)
      .eq('user_id', userId)
      .single();

    if (fetchError) {
      return res.status(400).json({ error: fetchError.message });
    }

    const milestone = {
      id: Date.now(),
      title,
      description,
      achievedAt: new Date().toISOString(),
    };

    const updatedMilestones = [...(journey.milestones || []), milestone];

    const { data, error } = await supabase
      .from('recovery_journeys')
      .update({ milestones: updatedMilestones })
      .eq('id', journeyId)
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({ milestone });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;
