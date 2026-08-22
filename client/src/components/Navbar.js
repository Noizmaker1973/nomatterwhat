import React, { useContext } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../App';
import { AuthContext } from '../context/AuthContext';
import './Navbar.css';

function Navbar() {
  const navigate = useNavigate();
  const { setUser } = useContext(AuthContext);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    navigate('/login');
  };

  return (
    <nav className="navbar">
      <div className="navbar-container">
        <Link to="/" className="navbar-brand">
          🌟 Recovery
        </Link>
        <ul className="nav-menu">
          <li><Link to="/">Dashboard</Link></li>
          <li><Link to="/sponsor">AI Sponsor</Link></li>
          <li><Link to="/stories">Stories</Link></li>
          <li><Link to="/meetings">Meetings</Link></li>
          <li><Link to="/profile">Profile</Link></li>
          <li><button onClick={handleLogout} className="logout-btn">Logout</button></li>
        </ul>
      </div>
    </nav>
  );
}

export default Navbar;
