const express = require('express');
const { supabase } = require('../config/firebase');
const { verifyToken } = require('../middleware/auth');
const router = express.Router();

// Sample meetings - can be replaced with real API integration
const SAMPLE_MEETINGS = [
  {
    id: '1',
    name: 'Monday Night Discussion',
    type: 'AA',
    address: '123 Main St, Springfield, IL 62701',
    coordinates: { lat: 39.7817, lng: -89.6501 },
    time: '19:00',
    day: 'Monday',
    description: 'Beginner-friendly discussion meeting',
  },
  {
    id: '2',
    name: 'Tuesday Step Study',
    type: 'NA',
    address: '456 Oak Ave, Springfield, IL 62702',
    coordinates: { lat: 39.7818, lng: -89.6502 },
    time: '19:30',
    day: 'Tuesday',
    description: 'Focus on the 12 steps',
  },
  {
    id: '3',
    name: 'Wednesday Newcomers',
    type: 'AA',
    address: '789 Pine Rd, Springfield, IL 62703',
    coordinates: { lat: 39.7819, lng: -89.6503 },
    time: '18:00',
    day: 'Wednesday',
    description: 'Perfect for newcomers',
  },
];

router.get('/nearby', async (req, res) => {
  try {
    const { latitude, longitude, radiusMiles = 10, type = 'both' } = req.query;

    if (!latitude || !longitude) {
      return res.status(400).json({ error: 'Latitude and longitude required' });
    }

    const userLat = parseFloat(latitude);
    const userLng = parseFloat(longitude);

    const filteredMeetings = SAMPLE_MEETINGS
      .filter(meeting => {
        if (type !== 'both' && meeting.type !== type) return false;

        const distance = calculateDistance(
          userLat,
          userLng,
          meeting.coordinates.lat,
          meeting.coordinates.lng
        );
        return distance <= radiusMiles;
      })
      .sort((a, b) => {
        const distA = calculateDistance(userLat, userLng, a.coordinates.lat, a.coordinates.lng);
        const distB = calculateDistance(userLat, userLng, b.coordinates.lat, b.coordinates.lng);
        return distA - distB;
      });

    res.json({ meetings: filteredMeetings });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/save-favorite', verifyToken, async (req, res) => {
  try {
    const { meetingId } = req.body;
    const userId = req.user.id;

    const { error } = await supabase
      .from('favorite_meetings')
      .upsert({
        user_id: userId,
        meeting_id: meetingId,
      });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({ message: 'Meeting added to favorites' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/favorites', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const { data, error } = await supabase
      .from('favorite_meetings')
      .select('meeting_id')
      .eq('user_id', userId);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    const favoriteIds = data.map(fav => fav.meeting_id);
    const favoriteMeetings = SAMPLE_MEETINGS.filter(m => favoriteIds.includes(m.id));

    res.json({ meetings: favoriteMeetings });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 3959; // Earth's radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

module.exports = router;
