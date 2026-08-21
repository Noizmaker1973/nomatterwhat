import React, { useState, useEffect } from 'react';
import apiClient from '../services/api';
import './Meetings.css';

function Meetings() {
  const [meetings, setMeetings] = useState([]);
  const [location, setLocation] = useState(null);
  const [loading, setLoading] = useState(false);
  const [radius, setRadius] = useState(10);
  const [type, setType] = useState('both');
  const [error, setError] = useState('');

  useEffect(() => {
    requestLocation();
  }, []);

  const requestLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setLocation({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          });
          searchMeetings(position.coords.latitude, position.coords.longitude);
        },
        (error) => {
          setError('Unable to get your location. Please enable location services.');
          console.error(error);
        }
      );
    }
  };

  const searchMeetings = async (lat, lng) => {
    setLoading(true);
    setError('');
    try {
      const response = await apiClient.getNearbyMeetings(lat, lng, radius, type);
      setMeetings(response.data.meetings);
    } catch (err) {
      setError('Error loading meetings. Please try again.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e) => {
    e.preventDefault();
    if (location) {
      searchMeetings(location.latitude, location.longitude);
    }
  };

  const handleSaveFavorite = async (meetingId) => {
    try {
      await apiClient.saveFavoriteMeeting(meetingId);
      alert('Meeting added to favorites!');
    } catch (error) {
      console.error('Error saving favorite:', error);
    }
  };

  return (
    <div className="meetings-container">
      <div className="meetings-header">
        <h1>Find AA & NA Meetings</h1>
        <p>Connect with your community near you</p>
      </div>

      {error && <div className="error-message">{error}</div>}

      <form onSubmit={handleSearch} className="search-form">
        <div className="form-group">
          <label>Search Radius (miles)</label>
          <input
            type="number"
            min="1"
            max="100"
            value={radius}
            onChange={(e) => setRadius(e.target.value)}
          />
        </div>

        <div className="form-group">
          <label>Program Type</label>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="both">Both AA & NA</option>
            <option value="AA">AA Only</option>
            <option value="NA">NA Only</option>
          </select>
        </div>

        <button type="submit" disabled={loading}>
          {loading ? 'Searching...' : 'Search Meetings'}
        </button>
      </form>

      <div className="meetings-list">
        {meetings.length === 0 ? (
          <p className="no-meetings">
            {loading ? 'Searching...' : 'No meetings found. Try expanding your search radius.'}
          </p>
        ) : (
          meetings.map((meeting) => (
            <div key={meeting.id} className="meeting-card">
              <div className="meeting-info">
                <h3>{meeting.name}</h3>
                <p className="meeting-type">{meeting.type}</p>
                <p className="meeting-time">
                  <strong>{meeting.day}</strong> at {meeting.time}
                </p>
                <p className="meeting-address">📍 {meeting.address}</p>
                <p className="meeting-description">{meeting.description}</p>
              </div>
              <button 
                onClick={() => handleSaveFavorite(meeting.id)}
                className="favorite-btn"
              >
                ⭐ Save
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default Meetings;
