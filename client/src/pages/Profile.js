import React, { useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../App';
import { AuthContext } from '../context/AuthContext';
import './Profile.css';

function Profile() {
  const { user, setUser } = useContext(AuthContext);
  const navigate = useNavigate();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    navigate('/login');
  };

  return (
    <div className="profile-container">
      <div className="profile-card">
        <h1>Your Profile</h1>

        <div className="profile-section">
          <h2>Account Information</h2>
          <p><strong>Email:</strong> {user?.email}</p>
          <p><strong>Member Since:</strong> {new Date(user?.created_at).toLocaleDateString()}</p>
        </div>

        <div className="profile-section">
          <h2>Preferences</h2>
          <p>You can customize your experience here in future updates.</p>
        </div>

        <div className="profile-section">
          <h2>Need Help?</h2>
          <p>If you're in crisis or experiencing urges:</p>
          <ul>
            <li>Contact SAMHSA's National Helpline: 1-800-662-4357 (free, confidential, 24/7)</li>
            <li>Text HOME to 741741 for Crisis Text Line</li>
            <li>Call 988 for Suicide & Crisis Lifeline</li>
          </ul>
        </div>

        <button onClick={handleLogout} className="logout-btn">Logout</button>
      </div>
    </div>
  );
}

export default Profile;
