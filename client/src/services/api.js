import axios from 'axios';
import { supabase } from '../App';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

const getHeaders = async () => {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;

  if (!token) {
    throw new Error('No authentication token available');
  }

  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
};

export const apiClient = {
  // Recovery endpoints
  startRecoveryJourney: async (sobrietyDate, notes) => {
    const headers = await getHeaders();
    return axios.post(`${API_URL}/recovery/start-journey`, 
      { sobrietyDate, notes }, 
      { headers }
    );
  },

  getJourney: async () => {
    const headers = await getHeaders();
    return axios.get(`${API_URL}/recovery/journey`, { headers });
  },

  addMilestone: async (journeyId, title, description) => {
    const headers = await getHeaders();
    return axios.post(`${API_URL}/recovery/add-milestone`,
      { journeyId, title, description },
      { headers }
    );
  },

  // Sponsor endpoints
  sponsorChat: async (message, conversationHistory = []) => {
    const headers = await getHeaders();
    return axios.post(`${API_URL}/sponsor/chat`,
      { message, conversationHistory },
      { headers }
    );
  },

  getSponsorHistory: async (limit = 50) => {
    const headers = await getHeaders();
    return axios.get(`${API_URL}/sponsor/conversation-history?limit=${limit}`, { headers });
  },

  // Stories endpoints
  uploadStory: async (title, description, mediaData, mediaType, duration) => {
    const headers = await getHeaders();
    return axios.post(`${API_URL}/stories/upload`,
      { title, description, mediaData, mediaType, duration },
      { headers }
    );
  },

  getPublicStories: async (limit = 20, offset = 0) => {
    return axios.get(`${API_URL}/stories/public?limit=${limit}&offset=${offset}`);
  },

  getMyStories: async () => {
    const headers = await getHeaders();
    return axios.get(`${API_URL}/stories/my-stories`, { headers });
  },

  likeStory: async (storyId) => {
    const headers = await getHeaders();
    return axios.post(`${API_URL}/stories/${storyId}/like`, {}, { headers });
  },

  // Meetings endpoints
  getNearbyMeetings: async (latitude, longitude, radiusMiles = 10, type = 'both') => {
    return axios.get(`${API_URL}/meetings/nearby`, {
      params: { latitude, longitude, radiusMiles, type }
    });
  },

  saveFavoriteMeeting: async (meetingId) => {
    const headers = await getHeaders();
    return axios.post(`${API_URL}/meetings/save-favorite`,
      { meetingId },
      { headers }
    );
  },

  getFavoriteMeetings: async () => {
    const headers = await getHeaders();
    return axios.get(`${API_URL}/meetings/favorites`, { headers });
  },
};

export default apiClient;
