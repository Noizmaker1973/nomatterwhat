import React, { useState, useEffect, useRef } from 'react';
import apiClient from '../services/api';
import './Stories.css';

function Stories() {
  const [stories, setStories] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [mediaData, setMediaData] = useState(null);
  const [mediaType, setMediaType] = useState('video');
  const [duration, setDuration] = useState(0);
  const videoRef = useRef(null);
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef(null);

  useEffect(() => {
    loadStories();
  }, []);

  const loadStories = async () => {
    setLoading(true);
    try {
      const response = await apiClient.getPublicStories(20, 0);
      setStories(response.data.stories);
    } catch (error) {
      console.error('Error loading stories:', error);
    } finally {
      setLoading(false);
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: true, 
        audio: true 
      });
      videoRef.current.srcObject = stream;
      videoRef.current.play();

      const mediaRecorder = new MediaRecorder(stream);
      const chunks = [];

      mediaRecorder.ondataavailable = (e) => {
        chunks.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        const reader = new FileReader();
        reader.onloadend = () => {
          setMediaData(reader.result);
          setMediaType('video');
          stream.getTracks().forEach(track => track.stop());
        };
        reader.readAsDataURL(blob);
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      setIsRecording(true);
    } catch (error) {
      console.error('Error accessing camera:', error);
      alert('Unable to access camera. Please check permissions.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const handleUploadStory = async (e) => {
    e.preventDefault();
    if (!mediaData) {
      alert('Please record a video first');
      return;
    }

    setLoading(true);
    try {
      await apiClient.uploadStory(title, description, mediaData, mediaType, duration);
      alert('Story uploaded successfully!');
      setTitle('');
      setDescription('');
      setMediaData(null);
      setDuration(0);
      setShowUploadForm(false);
      loadStories();
    } catch (error) {
      console.error('Error uploading story:', error);
      alert('Error uploading story. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleLikeStory = async (storyId) => {
    try {
      await apiClient.likeStory(storyId);
      loadStories();
    } catch (error) {
      console.error('Error liking story:', error);
    }
  };

  return (
    <div className="stories-container">
      <div className="stories-header">
        <h1>Recovery Stories</h1>
        <p>Share your journey, inspire others</p>
      </div>

      {!showUploadForm ? (
        <button 
          onClick={() => setShowUploadForm(true)}
          className="upload-btn"
        >
          📹 Share Your Story
        </button>
      ) : (
        <div className="upload-form">
          <h2>Record Your Recovery Story</h2>
          <p className="form-subtitle">Share up to 10 minutes of your journey</p>

          <div className="video-container">
            <video ref={videoRef} className="preview-video" />
            <div className="recording-controls">
              {!isRecording ? (
                <button onClick={startRecording} className="record-btn">
                  🔴 Start Recording
                </button>
              ) : (
                <button onClick={stopRecording} className="stop-btn">
                  ⏹ Stop Recording
                </button>
              )}
            </div>
          </div>

          {mediaData && (
            <div className="preview-section">
              <p className="success">✓ Video recorded successfully!</p>
            </div>
          )}

          <form onSubmit={handleUploadStory} className="story-form">
            <div className="form-group">
              <label>Story Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Give your story a title"
                required
              />
            </div>

            <div className="form-group">
              <label>Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Tell us about your recovery journey..."
                rows="4"
                required
              />
            </div>

            <button type="submit" disabled={loading || !mediaData}>
              {loading ? 'Uploading...' : 'Publish Story'}
            </button>
            <button 
              type="button" 
              onClick={() => setShowUploadForm(false)}
              className="cancel-btn"
            >
              Cancel
            </button>
          </form>
        </div>
      )}

      <div className="stories-grid">
        <h2>Stories of Hope</h2>
        {loading ? (
          <p>Loading stories...</p>
        ) : stories.length === 0 ? (
          <p>No stories yet. Be the first to share!</p>
        ) : (
          stories.map((story) => (
            <div key={story.id} className="story-card">
              <div className="story-media">
                {story.mediaType.includes('video') ? (
                  <video src={story.mediaUrl} controls />
                ) : (
                  <img src={story.mediaUrl} alt={story.title} />
                )}
              </div>
              <div className="story-content">
                <h3>{story.title}</h3>
                <p>{story.description}</p>
                <div className="story-footer">
                  <button 
                    onClick={() => handleLikeStory(story.id)}
                    className="like-btn"
                  >
                    ❤️ {story.likes}
                  </button>
                  <span className="story-date">
                    {new Date(story.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default Stories;
