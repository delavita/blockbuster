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
  apiKey: "AIzaSyBsLFoFOZkDlfAuncaNu7EbStGUP97zNYs",
  authDomain: "vita-64d71.firebaseapp.com",
  databaseURL: "https://vita-64d71-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "vita-64d71",
  storageBucket: "vita-64d71.firebasestorage.app",
  messagingSenderId: "1008164207419",
  appId: "1:1008164207419:web:be6d1fe677e1b18101551e"
};

// Initialise Firebase (compat SDK — works in plain <script> tags)
firebase.initializeApp(firebaseConfig);

// Export references used throughout app.js
const fbAuth = firebase.auth();
const fbDb   = firebase.firestore();
