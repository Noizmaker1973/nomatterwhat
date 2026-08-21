# Recovery App - Quick Start Guide

## 🚀 Running the App Locally

### Prerequisites
- Node.js 16+ installed
- Firebase project created
- Anthropic API key

### 30-Second Setup

1. **Backend Setup** (Terminal 1)
```bash
cd server
npm install
cp .env.example .env
# Edit .env with your Firebase and API keys
npm run dev
```

2. **Frontend Setup** (Terminal 2)
```bash
cd client
npm install
cp .env.example .env
# Edit .env with your Firebase config
npm start
```

3. **Access the app** at `http://localhost:3000`

---

## 📋 Step-by-Step First Time Setup

### Step 1: Firebase Project
1. Go to https://console.firebase.google.com
2. Create new project → "recovery-app"
3. Enable: Firestore, Storage, Authentication
4. Get service account key → `server/src/config/serviceAccountKey.json`
5. Copy web config → use in `.env`

### Step 2: Anthropic API
1. Get API key from https://www.anthropic.com
2. Add to `server/.env` as `ANTHROPIC_API_KEY`

### Step 3: Backend
```bash
cd server
npm install
npm run dev
# Should show: "Recovery app server running on port 5000"
```

### Step 4: Frontend
```bash
cd client
npm install
npm start
# Browser opens to http://localhost:3000
```

### Step 5: Test It
1. Register new account
2. Enter your sobriety date
3. Try "AI Sponsor" to chat
4. Try "Find Meetings" (uses sample data)

---

## 🛠️ Common Tasks

### Start Development
```bash
# Terminal 1 - Backend
cd server && npm run dev

# Terminal 2 - Frontend
cd client && npm start
```

### Install New Package
```bash
# Backend
cd server && npm install package-name

# Frontend
cd client && npm install package-name
```

### Rebuild Frontend
```bash
cd client
npm run build
# Creates optimized build in `client/build/`
```

### Run Tests (when added)
```bash
npm test
```

### Check Backend Health
```bash
curl http://localhost:5000/api/health
```

---

## 📁 Project Structure Quick Reference

```
recovery-app/
├── server/              # Backend (Express + Firebase)
│   ├── src/routes/      # API endpoints
│   ├── .env.example     # Copy to .env
│   └── package.json
├── client/              # Frontend (React)
│   ├── src/pages/       # Page components
│   ├── .env.example     # Copy to .env
│   └── package.json
├── docs/
│   └── SETUP.md        # Detailed setup guide
├── README.md           # Full documentation
└── CLAUDE.md           # Project architecture
```

---

## 🔑 Environment Variables

### Server (.env)
Required:
- `PORT` - Server port (default 5000)
- `FIREBASE_PROJECT_ID` - From Firebase
- `FIREBASE_DATABASE_URL` - From Firebase
- `FIREBASE_STORAGE_BUCKET` - From Firebase
- `ANTHROPIC_API_KEY` - Your API key

### Client (.env)
Required:
- `REACT_APP_FIREBASE_API_KEY`
- `REACT_APP_FIREBASE_AUTH_DOMAIN`
- `REACT_APP_FIREBASE_PROJECT_ID`
- `REACT_APP_FIREBASE_STORAGE_BUCKET`
- `REACT_APP_API_URL` - http://localhost:5000/api

---

## 🐛 Quick Troubleshooting

| Problem | Solution |
|---------|----------|
| "Cannot find serviceAccountKey.json" | Check path in server/.env, ensure file exists |
| "CORS error" | Make sure backend is running on 5000 |
| "Firebase not initialized" | Check all env vars are set correctly |
| "Video recording fails" | Allow camera/mic permissions in browser |
| "404 on API call" | Verify backend is running |
| "AI Sponsor not responding" | Check ANTHROPIC_API_KEY is set |

---

## 📊 Key API Endpoints

```
GET  /api/health                      - Server status
POST /api/auth/register               - Create account
GET  /api/recovery/journey            - Get journey
POST /api/recovery/start-journey      - Start tracking
POST /api/sponsor/chat                - Chat with AI
GET  /api/sponsor/conversation-history - Get history
GET  /api/meetings/nearby             - Find meetings
GET  /api/stories/public              - Browse stories
POST /api/stories/upload              - Upload story
```

---

## 🚀 Next Steps After Setup

1. **Customize** AI Sponsor prompt in `server/src/routes/sponsor.js`
2. **Add** real meeting directory API
3. **Deploy** to production (Firebase Hosting recommended)
4. **Add** tests and error handling
5. **Enhance** with peer messaging features

---

## 📞 Need Help?

1. Read `docs/SETUP.md` for detailed instructions
2. Check browser console for error messages
3. Verify all `.env` files are set correctly
4. Ensure both server and frontend are running

---

## 🌟 Features Available

✅ Recovery tracking (days clean/sober)
✅ AI sponsor 24/7 support
✅ Recovery story sharing
✅ Meeting locator (sample data)
✅ User profiles
✅ Crisis resources

---

## ⚠️ Important Reminders

- This app is a **support tool**, not a replacement for professional help
- Always encourage users to attend meetings
- Include crisis resources (SAMHSA: 1-800-662-4357)
- Keep in mind: Recovery is possible. You are not alone.

---

**Ready? Start with Step 1: Firebase Project above!** 🎉
