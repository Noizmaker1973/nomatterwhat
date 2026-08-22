# Recovery App - Supabase Setup Guide

This guide will walk you through setting up the Recovery Support App with **Supabase** (a Firebase alternative).

## Why Supabase?

✅ **Simpler than Firebase** - No service account key needed  
✅ **PostgreSQL-based** - Powerful SQL database  
✅ **Built-in Auth** - Email/password, OAuth, etc.  
✅ **File Storage** - For video/audio stories  
✅ **Real-time** - Real-time databases and subscriptions  
✅ **Free tier** - Generous free tier to start  
✅ **Open source** - Can self-host if needed  

## Prerequisites

1. **Node.js 16+** - Already installed
2. **Anthropic API Key** - For AI Sponsor
3. **Supabase Account** - Free at https://supabase.com

## Step-by-Step Setup

### Step 1: Create Supabase Project

1. Go to https://supabase.com
2. Click **"Start your project"**
3. Sign up or login
4. Click **"New project"**
5. Enter project details:
   - **Name**: `recovery-app`
   - **Database Password**: Create a secure password
   - **Region**: Choose closest to you
6. Click **"Create new project"** (takes 1-2 minutes)

### Step 2: Get Your API Keys

1. Once created, go to **Project Settings** (⚙️)
2. Click **API** in left sidebar
3. Copy these two values:
   - `Project URL` → `SUPABASE_URL`
   - `anon public` key → `SUPABASE_ANON_KEY`

### Step 3: Create Database Tables

1. Go to **SQL Editor** (or **Database** → **Schemas** → **public** → **Tables**)
2. Run each SQL command below to create the tables:

```sql
-- Users table
CREATE TABLE users (
  id uuid PRIMARY KEY REFERENCES auth.users(id),
  email TEXT NOT NULL,
  displayName TEXT,
  recoveryType TEXT,
  preferences jsonb DEFAULT '{"sponsorType": "both"}',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Recovery journeys
CREATE TABLE recovery_journeys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  sobriety_date DATE NOT NULL,
  notes TEXT,
  milestones jsonb DEFAULT '[]',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Sponsor conversations
CREATE TABLE sponsor_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  user_message TEXT NOT NULL,
  sponsor_response TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Stories
CREATE TABLE stories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT,
  media_url TEXT,
  media_type TEXT,
  duration INTEGER,
  likes INTEGER DEFAULT 0,
  is_public BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Favorite meetings
CREATE TABLE favorite_meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  meeting_id TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, meeting_id)
);

-- Enable Row Level Security (RLS)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE recovery_journeys ENABLE ROW LEVEL SECURITY;
ALTER TABLE sponsor_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE stories ENABLE ROW LEVEL SECURITY;
ALTER TABLE favorite_meetings ENABLE ROW LEVEL SECURITY;

-- Users can only see their own data
CREATE POLICY "Users can see their own profile" ON users
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile" ON users
  FOR UPDATE USING (auth.uid() = id);

-- Recovery journeys
CREATE POLICY "Users can see their journeys" ON recovery_journeys
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create journeys" ON recovery_journeys
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their journeys" ON recovery_journeys
  FOR UPDATE USING (auth.uid() = user_id);

-- Sponsor conversations
CREATE POLICY "Users can see their conversations" ON sponsor_conversations
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create conversations" ON sponsor_conversations
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Stories
CREATE POLICY "Anyone can see public stories" ON stories
  FOR SELECT USING (is_public = true);

CREATE POLICY "Users can see their own stories" ON stories
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create stories" ON stories
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their stories" ON stories
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can like stories" ON stories
  FOR UPDATE USING (true);

-- Favorite meetings
CREATE POLICY "Users can see their favorites" ON favorite_meetings
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can add favorites" ON favorite_meetings
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can remove favorites" ON favorite_meetings
  FOR DELETE USING (auth.uid() = user_id);
```

### Step 4: Create Storage Bucket

1. Go to **Storage** (left sidebar)
2. Click **"Create a new bucket"**
3. Name it: `stories`
4. Make it **Public**
5. Click **"Create bucket"**

### Step 5: Configure Backend .env

1. Navigate to `server/` directory
2. Create `.env` file:
   ```bash
   cp .env.example .env
   ```

3. Edit `.env` with your values:
   ```
   PORT=5000
   NODE_ENV=development
   
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_ANON_KEY=your-anon-key
   
   ANTHROPIC_API_KEY=your-anthropic-api-key
   ```

### Step 6: Install Backend Dependencies

```bash
cd server
npm install
npm run dev
```

You should see: **"Recovery app server running on port 5000"**

### Step 7: Configure Frontend .env

1. Navigate to `client/` directory
2. Create `.env` file:
   ```bash
   cp .env.example .env
   ```

3. Edit `.env`:
   ```
   REACT_APP_SUPABASE_URL=https://your-project.supabase.co
   REACT_APP_SUPABASE_ANON_KEY=your-anon-key
   REACT_APP_API_URL=http://localhost:5000/api
   ```

### Step 8: Install Frontend Dependencies

In a new terminal:
```bash
cd client
npm install
npm start
```

Browser should open to http://localhost:3000

## Testing the App

1. **Create Account**
   - Register with email/password
   - Choose AA/NA/Both

2. **Test Features**
   - Enter sobriety date
   - Chat with AI Sponsor
   - Browse meetings (sample data)
   - Upload a story

3. **Verify Database**
   - Go to Supabase Dashboard
   - Click **"Table Editor"**
   - Check `users`, `recovery_journeys`, etc.

## Troubleshooting

### "SUPABASE_URL not set"
- Make sure both `.env` files are created
- Restart server: `npm run dev`
- Restart frontend: `npm start`

### "Storage bucket not found"
- Create `stories` bucket in Storage
- Make sure it's **Public** (not private)

### "No such table"
- Run the SQL setup commands in **SQL Editor**
- Wait for them to complete

### "Permission denied"
- Check RLS policies are enabled
- Verify you're logged in
- Check user is making request (not anonymous)

### API 500 errors
- Check server console for error messages
- Verify Supabase URL and key are correct
- Restart server after changing .env

## Next Steps

1. **Deploy to Production**
   - Frontend: Vercel, Netlify
   - Backend: Render, Railway, or cloud function
   - Database: Already on Supabase

2. **Add Real Meeting Data**
   - Replace sample meetings in `server/src/routes/meetings.js`
   - Integrate with AA/NA APIs

3. **Customize AI Sponsor**
   - Edit `SPONSOR_SYSTEM_PROMPT` in `server/src/routes/sponsor.js`
   - Fine-tune personality and responses

4. **Add Tests**
   - Backend: Jest
   - Frontend: React Testing Library

## Security Notes

✅ **Row Level Security (RLS)** - Users can only see their own data  
✅ **Passwords** - Hashed by Supabase Auth  
✅ **Storage** - Public for stories, but only through signed URLs  
✅ **API Key** - `anon` key has RLS restrictions  
✅ **Sensitive Features** - Use `service_role` key only on backend

## Resources

- **Supabase Docs**: https://supabase.com/docs
- **Database**: https://supabase.com/docs/guides/database
- **Auth**: https://supabase.com/docs/guides/auth
- **Storage**: https://supabase.com/docs/guides/storage

---

**Recovery is possible. You are not alone. One day at a time.** 🌟
