const express = require('express');
const { db } = require('../config/firebase');
const { verifyToken } = require('../middleware/auth');
const { Anthropic } = require('@anthropic-ai/sdk');
const router = express.Router();

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const SPONSOR_SYSTEM_PROMPT = `You are an AI sponsor for someone in recovery from substance abuse. Your role is to provide support based on the principles of Alcoholics Anonymous (AA) and Narcotics Anonymous (NA). 

Key principles to reinforce:
- The 12 steps of AA/NA
- Acceptance of powerlessness over the addiction
- Faith and spiritual growth
- Connection to a higher power
- Making amends
- Service to others
- One day at a time
- The importance of community and meetings
- Healthy coping mechanisms

Your responses should be:
- Compassionate and non-judgmental
- Focused on helping the person through their current struggle
- Encouraging meetings and human sponsor connections
- Helping them apply AA/NA principles to their situation
- Acknowledging their progress and resilience

Remember: You are a supplement to, not a replacement for, human connection and professional help.`;

router.post('/chat', verifyToken, async (req, res) => {
  try {
    const { message, conversationHistory = [] } = req.body;
    const userId = req.user.uid;

    const messages = [
      ...conversationHistory.map(msg => ({
        role: msg.role,
        content: msg.content,
      })),
      {
        role: 'user',
        content: message,
      },
    ];

    const response = await client.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      system: SPONSOR_SYSTEM_PROMPT,
      messages,
    });

    const assistantMessage = response.content[0].text;

    await db
      .collection('users')
      .doc(userId)
      .collection('sponsor_conversations')
      .add({
        userMessage: message,
        sponsorResponse: assistantMessage,
        timestamp: new Date(),
      });

    res.json({
      response: assistantMessage,
      conversationId: userId,
    });
  } catch (error) {
    console.error('Sponsor chat error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/conversation-history', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const limit = req.query.limit || 50;

    const conversationSnap = await db
      .collection('users')
      .doc(userId)
      .collection('sponsor_conversations')
      .orderBy('timestamp', 'desc')
      .limit(parseInt(limit))
      .get();

    const conversations = conversationSnap.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      timestamp: doc.data().timestamp?.toISOString(),
    }));

    res.json({ conversations: conversations.reverse() });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;
