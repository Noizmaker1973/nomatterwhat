import React, { useState, useEffect, useRef } from 'react';
import apiClient from '../services/api';
import './Sponsor.css';

function Sponsor() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    loadConversationHistory();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const loadConversationHistory = async () => {
    try {
      const response = await apiClient.getSponsorHistory(20);
      const formattedMessages = [];
      response.data.conversations.forEach(conv => {
        formattedMessages.push({
          role: 'user',
          content: conv.userMessage,
          timestamp: conv.timestamp,
        });
        formattedMessages.push({
          role: 'assistant',
          content: conv.sponsorResponse,
          timestamp: conv.timestamp,
        });
      });
      setMessages(formattedMessages);
    } catch (error) {
      console.error('Error loading history:', error);
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userMessage = {
      role: 'user',
      content: input,
      timestamp: new Date().toISOString(),
    };

    setMessages([...messages, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const response = await apiClient.sponsorChat(input, messages);
      const assistantMessage = {
        role: 'assistant',
        content: response.data.response,
        timestamp: new Date().toISOString(),
      };
      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Error:', error);
      const errorMessage = {
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try again.',
        timestamp: new Date().toISOString(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="sponsor-container">
      <div className="sponsor-header">
        <h1>Your AI Sponsor</h1>
        <p>A supportive voice when you need it most</p>
      </div>

      <div className="sponsor-info">
        <p>
          Your AI Sponsor is here to help you through difficult moments. 
          Based on AA/NA principles, I'm here to listen and support your recovery. 
          Remember: this is a supplement to, not a replacement for, human connection and meetings.
        </p>
      </div>

      <div className="chat-container">
        <div className="messages">
          {messages.length === 0 ? (
            <div className="welcome-message">
              <h2>Welcome to Your AI Sponsor</h2>
              <p>Share what's on your mind. Whether you're struggling with urges, 
                 celebrating a victory, or just need someone to talk to - I'm here.</p>
              <p>Tell me how you're feeling today.</p>
            </div>
          ) : (
            messages.map((msg, idx) => (
              <div key={idx} className={`message ${msg.role}`}>
                <div className="message-content">
                  <p>{msg.content}</p>
                  <span className="message-time">
                    {new Date(msg.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              </div>
            ))
          )}
          {loading && (
            <div className="message assistant loading">
              <div className="typing-indicator">
                <span></span><span></span><span></span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <form onSubmit={handleSendMessage} className="chat-form">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Share your thoughts..."
            disabled={loading}
          />
          <button type="submit" disabled={loading || !input.trim()}>
            Send
          </button>
        </form>
      </div>
    </div>
  );
}

export default Sponsor;
