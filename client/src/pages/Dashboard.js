import React, { useContext, useEffect, useState } from 'react';
import { AuthContext } from '../context/AuthContext';
import apiClient from '../services/api';
import './Dashboard.css';

function Dashboard() {
  const { user } = useContext(AuthContext);
  const [journey, setJourney] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showStartForm, setShowStartForm] = useState(false);
  const [sobrietyDate, setSobrietyDate] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    loadJourney();
  }, []);

  const loadJourney = async () => {
    try {
      const response = await apiClient.getJourney();
      setJourney(response.data.journey);
    } catch (error) {
      console.error('Error loading journey:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleStartJourney = async (e) => {
    e.preventDefault();
    try {
      await apiClient.startRecoveryJourney(sobrietyDate, notes);
      setSobrietyDate('');
      setNotes('');
      setShowStartForm(false);
      loadJourney();
    } catch (error) {
      console.error('Error starting journey:', error);
    }
  };

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h1>Welcome, {user?.displayName || 'Friend'}!</h1>
        <p>You are not alone in this journey</p>
      </div>

      {!journey ? (
        <div className="start-journey-section">
          <h2>Start Your Recovery Journey</h2>
          <p>Let's begin tracking your path to freedom</p>
          
          {!showStartForm ? (
            <button 
              onClick={() => setShowStartForm(true)}
              className="start-btn"
            >
              Start Your Journey
            </button>
          ) : (
            <form onSubmit={handleStartJourney} className="start-form">
              <div className="form-group">
                <label>When did you get sober/clean?</label>
                <input
                  type="date"
                  value={sobrietyDate}
                  onChange={(e) => setSobrietyDate(e.target.value)}
                  required
                />
              </div>
              
              <div className="form-group">
                <label>Notes (optional)</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="What motivated this change?"
                  rows="4"
                />
              </div>
              
              <button type="submit" className="submit-btn">Start Tracking</button>
              <button 
                type="button" 
                onClick={() => setShowStartForm(false)}
                className="cancel-btn"
              >
                Cancel
              </button>
            </form>
          )}
        </div>
      ) : (
        <div className="recovery-tracker">
          <div className="recovery-card">
            <h2>Your Recovery Status</h2>
            <div className="days-clean">
              <span className="days-number">{journey.daysClean}</span>
              <span className="days-label">Days Clean & Sober</span>
            </div>
            <p className="sobriety-date">
              Since {new Date(journey.sobrietyDate).toLocaleDateString()}
            </p>
          </div>

          <div className="milestones-section">
            <h3>Milestones</h3>
            {journey.milestones && journey.milestones.length > 0 ? (
              <ul className="milestones-list">
                {journey.milestones.map((milestone) => (
                  <li key={milestone.id} className="milestone-item">
                    <strong>{milestone.title}</strong>
                    <p>{milestone.description}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="no-milestones">No milestones yet. Keep going!</p>
            )}
          </div>
        </div>
      )}

      <div className="quick-actions">
        <h2>Quick Actions</h2>
        <div className="actions-grid">
          <a href="/sponsor" className="action-card sponsor-card">
            <div className="action-icon">💬</div>
            <h3>Talk to Sponsor</h3>
            <p>Get support when you need it</p>
          </a>
          <a href="/meetings" className="action-card meetings-card">
            <div className="action-icon">📍</div>
            <h3>Find Meetings</h3>
            <p>Connect with your community</p>
          </a>
          <a href="/stories" className="action-card stories-card">
            <div className="action-icon">📚</div>
            <h3>Recovery Stories</h3>
            <p>Gain hope and inspiration</p>
          </a>
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
