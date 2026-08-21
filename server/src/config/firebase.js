const admin = require('firebase-admin');
const path = require('path');

// Initialize Firebase Admin SDK
// Make sure to set FIREBASE_CONFIG_PATH environment variable or place your service account key in this directory
let serviceAccountPath = process.env.FIREBASE_CONFIG_PATH;
if (!serviceAccountPath) {
  serviceAccountPath = path.join(__dirname, 'serviceAccountKey.json');
}

try {
  const serviceAccount = require(serviceAccountPath);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  });
} catch (error) {
  console.warn('Firebase service account not found. In production, ensure FIREBASE_CONFIG_PATH is set.');
  // For development, Firebase emulator can be used
  if (process.env.FIREBASE_EMULATOR_HOST) {
    admin.initializeApp({
      projectId: process.env.FIREBASE_PROJECT_ID,
    });
  }
}

const db = admin.firestore();
const storage = admin.storage();
const auth = admin.auth();

module.exports = { admin, db, storage, auth };
