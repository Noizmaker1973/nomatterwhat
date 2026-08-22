import React, { useState, useContext } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '../App';
import { AuthContext } from '../context/AuthContext';
import './Auth.css';

function Register() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [recoveryType, setRecoveryType] = useState('AA');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { setUser } = useContext(AuthContext);

  const handleRegister = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const { data, error: signUpError } = await supabase.auth.signUpWithPassword({
        email,
        password,
      });

      if (signUpError) throw signUpError;

      setUser(data.user);
      navigate('/');
    } catch (err) {
      setError(err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <h1>Start Your Journey</h1>
        <p className="auth-subtitle">One day at a time, we recover together</p>
        
        {error && <div className="error-message">{error}</div>}
        
        <form onSubmit={handleRegister}>
          <div className="form-group">
            <label>Name</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your name"
              required
            />
          </div>
          
          <div className="form-group">
            <label>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              required
            />
          </div>
          
          <div className="form-group">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Create a password"
              required
            />
          </div>
          
          <div className="form-group">
            <label>Program Type</label>
            <select 
              value={recoveryType} 
              onChange={(e) => setRecoveryType(e.target.value)}
            >
              <option value="AA">Alcoholics Anonymous (AA)</option>
              <option value="NA">Narcotics Anonymous (NA)</option>
              <option value="Both">Both AA and NA</option>
            </select>
          </div>
          
          <button type="submit" disabled={loading} className="submit-btn">
            {loading ? 'Creating account...' : 'Create Account'}
          </button>
        </form>
        
        <p className="auth-footer">
          Already have an account? <Link to="/login">Login here</Link>
        </p>
      </div>
    </div>
  );
}

export default Register;
