# Recovery Support App - Project Documentation

## Project Overview

A comprehensive web application designed to support individuals in recovery from substance abuse. The app provides sobriety/clean time tracking, AI-powered sponsor support, meeting locator, and a community story library.

## Key Features Implemented

### 1. **Recovery Tracking Dashboard**
- Track sobriety/clean dates with visual counter (days clean)
- Record and manage recovery milestones
- Personal recovery journey management
- **Files**: `client/src/pages/Dashboard.js`, `server/src/routes/recovery.js`

### 2. **AI Sponsor Chat (24/7 Support)**
- Real-time chat interface with Claude AI
- AI trained on AA/NA principles and the 12 Steps
- Conversation history saved to Firebase
- Reinforces recovery principles during difficult moments
- **Files**: `client/src/pages/Sponsor.js`, `server/src/routes/sponsor.js`
- **Model**: Anthropic Claude 3.5 Sonnet

### 3. **Meeting Locator**
- Find AA/NA meetings near user's location using geolocation
- Filter by program type (AA/NA) and radius
- Save favorite meetings for quick access
- Sample data included; ready for real API integration
- **Files**: `client/src/pages/Meetings.js`, `server/src/routes/meetings.js`

### 4. **Recovery Story Library**
- Users can record up to 10-minute video stories
- Share recovery journey with community
- Browse public stories from other people in recovery
- Like and interact with stories
- Stories stored in Firebase Storage with signed URLs
- **Files**: `client/src/pages/Stories.js`, `server/src/routes/stories.js`

### 5. **Authentication & User Management**
- Firebase Authentication (Email/Password)
- User profiles with recovery preferences
- Secure token-based API authentication
- **Files**: `server/src/routes/auth.js`, `server/src/middleware/auth.js`

## Architecture

### Backend (Node.js + Express)
```
server/
├── src/
│   ├── index.js              # Express server
│   ├── config/firebase.js    # Firebase initialization
│   ├── middleware/auth.js    # JWT/Token verification
│   └── routes/
│       ├── auth.js           # User registration/login
│       ├── recovery.js       # Sobriety tracking
│       ├── sponsor.js        # AI sponsor chat
│       ├── stories.js        # Story CRUD & storage
│       └── meetings.js       # Meeting search & filtering
```

### Frontend (React 18)
```
client/src/
├── pages/
│   ├── Dashboard.js          # Main recovery tracker
│   ├── Login.js              # Login page
│   ├── Register.js           # Registration
│   ├── Sponsor.js            # AI sponsor interface
│   ├── Sponsor.js            # Story sharing
│   ├── Meetings.js           # Meeting locator
│   └── Profile.js            # User profile
├── components/
│   └── Navbar.js             # Navigation
├── services/api.js           # API client
└── context/AuthContext.js    # Auth state
```

### Database (Firestore Structure)
```
/users
  /{userId}
    - email, displayName
    - recoveryType (AA/NA/Both)
    - preferences
    /recovery
      - sobrietyDate
      - milestones[]
      /sponsor_conversations
        - userMessage
        - sponsorResponse
        - timestamp
      /favorite_meetings
        - savedAt

/stories
  /{storyId}
    - userId, title, description
    - mediaUrl (Firebase Storage URL)
    - likes, comments
    - createdAt, isPublic
```

## API Endpoints

### Authentication
- `POST /api/auth/register` - Create new user account
- `POST /api/auth/login` - Login (handled client-side via Firebase)

### Recovery Tracking
- `POST /api/recovery/start-journey` - Initialize recovery journey
- `GET /api/recovery/journey` - Fetch current journey
- `POST /api/recovery/add-milestone` - Add achievement milestone

### AI Sponsor
- `POST /api/sponsor/chat` - Send message, receive AI response
- `GET /api/sponsor/conversation-history` - Fetch past conversations

### Stories
- `POST /api/stories/upload` - Upload video story
- `GET /api/stories/public` - Get public story feed
- `GET /api/stories/my-stories` - Get user's stories
- `POST /api/stories/{storyId}/like` - Like a story

### Meetings
- `GET /api/meetings/nearby` - Find meetings by location
- `POST /api/meetings/save-favorite` - Save meeting to favorites
- `GET /api/meetings/favorites` - Get saved meetings

## Environment Setup

### Backend (.env)
```
PORT=5000
FIREBASE_PROJECT_ID=...
FIREBASE_DATABASE_URL=...
FIREBASE_STORAGE_BUCKET=...
ANTHROPIC_API_KEY=...
```

### Frontend (.env)
```
REACT_APP_FIREBASE_API_KEY=...
REACT_APP_FIREBASE_AUTH_DOMAIN=...
REACT_APP_FIREBASE_PROJECT_ID=...
REACT_APP_FIREBASE_STORAGE_BUCKET=...
REACT_APP_API_URL=http://localhost:5000/api
```

See `docs/SETUP.md` for complete setup instructions.

## Key Technologies

- **Frontend**: React 18, React Router v6, Firebase SDK
- **Backend**: Node.js, Express, Firebase Admin SDK
- **Database**: Firestore (NoSQL)
- **Storage**: Firebase Cloud Storage
- **Authentication**: Firebase Auth
- **AI**: Anthropic Claude API
- **Styling**: CSS3 with CSS Variables
- **Build**: Create React App, Node/npm

## Security

- ✅ Firebase authentication for all users
- ✅ Server-side token verification on protected routes
- ✅ Sensitive data encrypted in Firestore
- ✅ Media stored in Firebase Storage with access controls
- ✅ Environment variables for secrets
- ✅ CORS configured for local development

## Important Notes

### AI Sponsor Limitations
The AI Sponsor is designed as a **supplement, not replacement** for:
- Professional mental health treatment
- Licensed therapists or counselors
- Sponsorship from experienced AA/NA members
- Attending regular meetings

### Crisis Resources
All users have access to:
- SAMHSA National Helpline: 1-800-662-4357
- Crisis Text Line: Text HOME to 741741
- Suicide & Crisis Lifeline: 988

### Sample Data
The meeting locator currently uses sample data. For production, integrate with:
- AA.org meeting finder API
- NA.org meeting directory
- Local recovery resource databases

## Development Workflow

### Starting Development
```bash
# Terminal 1 - Backend
cd server
npm install
npm run dev  # Runs on port 5000

# Terminal 2 - Frontend
cd client
npm install
npm start    # Runs on port 3000
```

### Making Changes
1. Backend changes: restart server with Ctrl+C and `npm run dev`
2. Frontend changes: hot reload automatically
3. Test in browser at http://localhost:3000

## Future Enhancements

### High Priority
1. Integrate with real AA/NA meeting APIs
2. Add unit tests for backend and frontend
3. Implement email verification
4. Add password reset functionality
5. Deploy to production environment

### Medium Priority
1. Peer-to-peer messaging between users
2. Sponsor matching system
3. Recovery milestone achievements/badges
4. Push notifications for meeting reminders
5. Advanced recovery analytics and progress tracking

### Lower Priority
1. Mobile app (React Native)
2. Offline support
3. Multiple language support
4. Integration with therapist/counselor resources
5. Peer support groups and chat rooms

## Testing

Currently no test suite. Recommended:
- Jest for backend API testing
- React Testing Library for frontend component tests
- Integration tests for API endpoints
- E2E tests with Playwright or Cypress

## Deployment

### Firebase Hosting (Recommended)
- Frontend: Deploy to Firebase Hosting
- Backend: Deploy to Cloud Functions or Cloud Run
- See Firebase documentation for full-stack deployment

### Alternative Hosting
- Frontend: Vercel, Netlify
- Backend: Heroku, AWS Lambda, Google Cloud Run
- Database: Firestore (managed)

## Troubleshooting

### Common Issues
1. "Firebase service account not found" → Check `serviceAccountKey.json` path
2. "CORS errors" → Ensure backend is running on port 5000
3. "Video recording not working" → Check browser permissions
4. "API not found" → Check both frontend and backend are running

See `docs/SETUP.md` for detailed troubleshooting.

## Resources

- **Firebase**: https://firebase.google.com/docs
- **Anthropic Claude**: https://docs.anthropic.com
- **React**: https://react.dev
- **AA.org**: https://www.aa.org
- **NA.org**: https://www.na.org

## Project Goals

This app aims to:
1. ✅ Reduce stigma around addiction and recovery
2. ✅ Provide 24/7 support for people in recovery
3. ✅ Build community through shared stories
4. ✅ Help people access recovery resources
5. ✅ Track progress and celebrate milestones
6. ✅ Reinforce AA/NA principles through technology

## Disclaimer

This is a support tool. It is NOT a replacement for:
- Professional medical treatment
- Licensed therapists or counselors
- Sponsorship from experienced recovery members
- Regular meeting attendance
- Emergency services

**If in crisis, call 911 or contact SAMHSA: 1-800-662-4357**

---

**Remember: Recovery is possible. You are not alone. One day at a time.** 🌟
