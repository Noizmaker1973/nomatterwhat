# Recovery App - Complete Setup Guide

This guide will walk you through setting up the Recovery Support App from scratch.

## Prerequisites

1. **Node.js & npm**
   - Download from https://nodejs.org/ (LTS version recommended)
   - Verify installation: `node --version` and `npm --version`

2. **Firebase Account**
   - Sign up at https://firebase.google.com
   - Create a new project

3. **Anthropic API Key**
   - Sign up at https://www.anthropic.com
   - Get your API key from the dashboard

4. **Git** (optional but recommended)
   - For version control and deployment

## Step 1: Firebase Setup

1. **Create Firebase Project:**
   - Go to Firebase Console (https://console.firebase.google.com/)
   - Click "Add project"
   - Name it "recovery-app"
   - Accept defaults and create

2. **Enable Services:**
   - In left sidebar, go to Build → Firestore Database
   - Click "Create database"
   - Start in production mode
   - Choose a location closest to your users
   
   - Go to Build → Storage
   - Click "Get started"
   - Use default bucket

   - Go to Build → Authentication
   - Click "Get started"
   - Enable "Email/Password" provider

3. **Get Service Account Key:**
   - Go to Project Settings (⚙️) → Service Accounts
   - Click "Generate new private key"
   - Save as `server/src/config/serviceAccountKey.json`
   - ⚠️ Keep this file secret! Never commit it to git.

4. **Get Web Config:**
   - Go to Project Settings (⚙️) → Your apps
   - Click </> to register web app
   - Copy the config object (you'll need this for .env)

## Step 2: Backend Setup

1. **Navigate to server directory:**
   ```bash
   cd server
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Create .env file:**
   ```bash
   cp .env.example .env
   ```

4. **Edit .env with your values:**
   ```
   PORT=5000
   NODE_ENV=development
   
   # From Firebase Project Settings
   FIREBASE_PROJECT_ID=your-project-id
   FIREBASE_DATABASE_URL=https://your-project.firebaseio.com
   FIREBASE_STORAGE_BUCKET=your-project.appspot.com
   FIREBASE_CONFIG_PATH=./src/config/serviceAccountKey.json
   
   # Your Anthropic API Key
   ANTHROPIC_API_KEY=your-api-key-here
   ```

5. **Start the server:**
   ```bash
   npm run dev
   ```
   You should see: "Recovery app server running on port 5000"

## Step 3: Frontend Setup

1. **In a new terminal, navigate to client directory:**
   ```bash
   cd client
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Create .env file:**
   ```bash
   cp .env.example .env
   ```

4. **Edit .env with Firebase config:**
   ```
   REACT_APP_FIREBASE_API_KEY=your-api-key
   REACT_APP_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
   REACT_APP_FIREBASE_PROJECT_ID=your-project-id
   REACT_APP_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
   REACT_APP_FIREBASE_MESSAGING_SENDER_ID=your-sender-id
   REACT_APP_FIREBASE_APP_ID=your-app-id
   REACT_APP_API_URL=http://localhost:5000/api
   ```
   (Get these values from your Firebase web app config)

5. **Start the frontend:**
   ```bash
   npm start
   ```
   Browser should open to http://localhost:3000

## Step 4: First Run

1. **Create an account:**
   - Click "Create Account" on the login page
   - Fill in your details
   - Choose AA/NA/Both for program type

2. **Start your recovery journey:**
   - Enter your sobriety/clean date
   - Start tracking!

3. **Try the features:**
   - Dashboard: View your clean/sober time
   - AI Sponsor: Chat about recovery
   - Meetings: Find local meetings (uses sample data)
   - Stories: Share your recovery story

## Troubleshooting

### "Firebase service account not found"
- Ensure `serviceAccountKey.json` is in `server/src/config/`
- Check the path in your .env file

### "Cannot find module '@anthropic-ai/sdk'"
- Run `npm install` in the server directory
- Restart the server

### "Firebase Database URL is not set"
- Check your .env file has all Firebase values
- Restart both server and frontend

### Video recording not working
- Check browser permissions for camera/microphone
- Some browsers require HTTPS (use localhost for http)
- Firefox and Chrome work best

### Meetings showing sample data
- This is expected! The current implementation uses sample data.
- In production, integrate with AA/NA official meeting APIs

### "CORS" errors
- Make sure backend is running on port 5000
- Check REACT_APP_API_URL in client .env matches

## Deployment

### Hosting Frontend
1. Build the app: `npm run build` in client directory
2. Deploy to Vercel, Netlify, or Firebase Hosting

### Hosting Backend
1. Deploy to Heroku, AWS, or Google Cloud Platform
2. Update REACT_APP_API_URL in client .env to point to production backend
3. Set production environment variables

### Firebase Hosting (Full Stack)
See Firebase documentation for full-stack deployment options.

## Security Checklist

- ✅ Never commit serviceAccountKey.json
- ✅ Never commit .env files with real keys
- ✅ Use environment variables in production
- ✅ Enable Firebase security rules
- ✅ Use HTTPS in production
- ✅ Regularly rotate API keys
- ✅ Monitor Firebase usage and costs

## Next Steps

1. Customize the AI sponsor prompt in `server/src/routes/sponsor.js`
2. Integrate with real AA/NA meeting directories
3. Add more recovery features (sponsors, accountability partners, etc.)
4. Set up proper error logging
5. Add unit and integration tests
6. Deploy to production

## Support

If you encounter issues:
1. Check the troubleshooting section above
2. Review Firebase and Anthropic documentation
3. Check browser console for error messages
4. Verify all environment variables are set correctly

---

**Remember: You are not alone. Recovery is possible.** 🌟
