const express = require('express');
const cors = require('cors');
require('dotenv').config();
const authRoutes = require('./routes/auth');
const recoveryRoutes = require('./routes/recovery');
const sponsorRoutes = require('./routes/sponsor');
const storiesRoutes = require('./routes/stories');
const meetingsRoutes = require('./routes/meetings');

const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/recovery', recoveryRoutes);
app.use('/api/sponsor', sponsorRoutes);
app.use('/api/stories', storiesRoutes);
app.use('/api/meetings', meetingsRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Recovery app server running on port ${PORT}`);
});

module.exports = app;
