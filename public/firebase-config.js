/* =============================================================
   FIREBASE CONFIGURATION
   ---------------------------------------------------------------
   HOW TO SET UP:
   1. Go to https://console.firebase.google.com
   2. Create a project (e.g. "bugbuster-pro")
   3. Enable Authentication -> Sign-in method -> Email/Password
   4. Create Firestore Database (Start in test mode for dev)
   5. Project Settings -> Your apps -> Add web app
   6. Copy your config values below
   7. Run the app, then open http://localhost:3000
      The app will auto-seed the demo accounts + data on first load.
   ============================================================= */

const firebaseConfig = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT_ID.firebaseapp.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId:             "YOUR_APP_ID"
};

// Initialise Firebase (compat SDK — works in plain <script> tags)
firebase.initializeApp(firebaseConfig);

// Export references used throughout app.js
const fbAuth = firebase.auth();
const fbDb   = firebase.firestore();
