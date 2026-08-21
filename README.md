# Recovery Support App

A comprehensive recovery support application for individuals in recovery from substance abuse. The app tracks sobriety/clean time, provides an AI-powered sponsor for support, helps find local AA/NA meetings, and allows people to share their recovery stories.

## Features

### 1. **Recovery Tracking**
   - Track your sobriety or clean date
   - Display days clean/sober with a beautiful tracker
   - Record milestones and achievements
   - Visual progress indicators

### 2. **AI Sponsor Support**
   - Chat with an AI sponsor based on AA/NA principles
   - Support reinforced by the 12 Steps
   - Available 24/7 for urges and difficult moments
   - Conversation history saved for personal reference
   - Not a replacement for human sponsors and meetings

### 3. **Meeting Locator**
   - Find AA and NA meetings near your location
   - Filter by program type and distance
   - Save favorite meetings
   - Integration with geolocation services
   - Expandable to integrate with real meeting directories

### 4. **Recovery Story Library**
   - Record 10-minute video stories of your recovery journey
   - Share your story with the recovery community
   - View and like other recovery stories
   - Build a library of hope and inspiration
   - Stories stored securely in the cloud

### 5. **User Profile & Resources**
   - Manage account settings
   - Access crisis resources
   - Emergency contact information for support services

## Tech Stack

### Backend
- **Framework**: Node.js + Express
- **Database**: Firebase Firestore
- **Storage**: Firebase Storage (for video/audio stories)
- **Authentication**: Firebase Authentication
- **AI**: Anthropic Claude API (for AI Sponsor)
- **Language**: JavaScript

### Frontend
- **Framework**: React 18
- **Routing**: React Router v6
- **State Management**: React Context API
- **Firebase SDK**: For authentication and real-time updates
- **Styling**: CSS3 with CSS variables
- **Styling**: Responsive design (mobile-first)

## Project Structure

```
recovery-app/
├── server/
│   ├── src/
│   │   ├── index.js                 # Express server entry point
│   │   ├── config/
│   │   │   └── firebase.js          # Firebase configuration
│   │   ├── middleware/
│   │   │   └── auth.js              # Authentication middleware
│   │   ├── routes/
│   │   │   ├── auth.js              # Authentication endpoints
│   │   │   ├── recovery.js          # Recovery tracking endpoints
│   │   │   ├── sponsor.js           # AI Sponsor endpoints
│   │   │   ├── stories.js           # Story sharing endpoints
│   │   │   └── meetings.js          # Meeting locator endpoints
│   │   ├── controllers/             # Business logic (expandable)
│   │   ├── models/                  # Data models (expandable)
│   │   └── utils/                   # Utility functions
│   ├── package.json
│   ├── .env.example
│   └── .gitignore
│
├── client/
│   ├── src/
│   │   ├── App.js                   # Main app component
│   │   ├── App.css
│   │   ├── index.js                 # React entry point
│   │   ├── index.css                # Global styles
│   │   ├── context/
│   │   │   └── AuthContext.js       # Auth context provider
│   │   ├── pages/
│   │   │   ├── Dashboard.js         # Recovery tracker dashboard
│   │   │   ├── Login.js             # Login page
│   │   │   ├── Register.js          # Registration page
│   │   │   ├── Sponsor.js           # AI sponsor chat
│   │   │   ├── Meetings.js          # Meeting locator
│   │   │   ├── Stories.js           # Story sharing & library
│   │   │   ├── Profile.js           # User profile
│   │   │   └── [page].css
│   │   ├── components/
│   │   │   ├── Navbar.js            # Navigation bar
│   │   │   └── Navbar.css
│   │   ├── services/
│   │   │   └── api.js               # API client
│   │   ├── hooks/                   # Custom React hooks (expandable)
│   │   └── utils/                   # Utility functions
│   ├── public/
│   │   └── index.html
│   ├── package.json
│   ├── .env.example
│   └── .gitignore
│
└── docs/
    └── SETUP.md                     # Detailed setup guide
```

## Quick Start

### Prerequisites
- Node.js 16+ and npm
- Firebase account with Firestore, Storage, and Authentication enabled
- Anthropic API key for Claude AI

### Installation

See [SETUP.md](docs/SETUP.md) for detailed setup instructions.

**Quick version:**

1. **Clone and navigate to project:**
   ```bash
   cd recovery-app
   ```

2. **Setup Firebase:**
   - Create a Firebase project
   - Enable Firestore, Storage, and Authentication (Email/Password)
   - Download service account key and place it in `server/src/config/serviceAccountKey.json`

3. **Backend setup:**
   ```bash
   cd server
   npm install
   cp .env.example .env
   # Edit .env with your Firebase and API keys
   npm run dev
   ```

4. **Frontend setup** (in a new terminal):
   ```bash
   cd client
   npm install
   cp .env.example .env
   # Edit .env with your Firebase config
   npm start
   ```

5. Access the app at `http://localhost:3000`

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login (Firebase handles this client-side)

### Recovery Tracking
- `POST /api/recovery/start-journey` - Start recovery journey
- `GET /api/recovery/journey` - Get current journey
- `POST /api/recovery/add-milestone` - Add milestone

### AI Sponsor
- `POST /api/sponsor/chat` - Send message to AI sponsor
- `GET /api/sponsor/conversation-history` - Get chat history

### Stories
- `POST /api/stories/upload` - Upload recovery story
- `GET /api/stories/public` - Get public stories
- `GET /api/stories/my-stories` - Get user's stories
- `POST /api/stories/:storyId/like` - Like a story

### Meetings
- `GET /api/meetings/nearby` - Find nearby meetings
- `POST /api/meetings/save-favorite` - Save favorite meeting
- `GET /api/meetings/favorites` - Get favorite meetings

## Important Resources

### Crisis Support Resources
- **SAMHSA National Helpline**: 1-800-662-4357 (free, confidential, 24/7)
- **Crisis Text Line**: Text HOME to 741741
- **Suicide & Crisis Lifeline**: 988
- **AA.org**: https://www.aa.org/
- **NA.org**: https://www.na.org/

## Future Enhancements

1. **Real Meeting Directory Integration**
   - Integrate with AA/NA official meeting APIs
   - Real-time meeting updates

2. **Community Features**
   - Peer-to-peer messaging
   - Support groups
   - Accountability partners

3. **Advanced Analytics**
   - Recovery streak tracking
   - Progress charts and statistics
   - Mood/wellness tracking

4. **Mobile Apps**
   - React Native mobile app
   - Offline support
   - Push notifications

5. **Enhanced AI Features**
   - Personalized support based on recovery type
   - Learning from user interactions
   - Integration with therapist resources

6. **Meeting Sponsorship Features**
   - Find local sponsors
   - Mentor connections
   - Sponsee tracking

## Security Considerations

- Firebase handles authentication securely
- All API endpoints require authentication tokens
- Sensitive data is encrypted at rest
- HTTPS required for all communications
- Video/audio stored securely in Firebase Storage with access controls

## Contributing

This is a recovery support tool. All contributions should:
- Maintain compassion and respect for the recovery community
- Follow AA/NA principles in AI sponsor responses
- Ensure privacy and security of user data
- Include crisis resources and disclaimers

## License

MIT License - See LICENSE file for details

## Disclaimer

This app is a support tool and NOT a replacement for:
- Professional medical treatment
- Licensed therapists or counselors
- Sponsorship from experienced AA/NA members
- Attending regular meetings
- Emergency medical services

If you or someone else is in crisis, please contact emergency services or use the resources listed above.

## Support

For issues, questions, or suggestions, please open an issue or contact the development team.

---

**Remember: You are not alone. Recovery is possible. One day at a time.** 🌟
