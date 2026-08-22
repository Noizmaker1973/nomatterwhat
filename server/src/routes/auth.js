const express = require('express');
const { supabase } = require('../config/firebase');
const router = express.Router();

router.post('/register', async (req, res) => {
  try {
    const { email, password, displayName, recoveryType } = req.body;

    const { data: authData, error: authError } = await supabase.auth.signUpWithPassword({
      email,
      password,
    });

    if (authError) {
      return res.status(400).json({ error: authError.message });
    }

    const userId = authData.user.id;

    const { error: profileError } = await supabase
      .from('users')
      .insert({
        id: userId,
        email,
        displayName,
        recoveryType,
        preferences: { sponsorType: 'both' },
      });

    if (profileError) {
      return res.status(400).json({ error: profileError.message });
    }

    res.json({
      uid: userId,
      email: authData.user.email,
      message: 'Account created successfully'
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/login', async (req, res) => {
  res.json({ message: 'Use Supabase client SDK for login' });
});

module.exports = router;
