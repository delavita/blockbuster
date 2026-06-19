# BugBuster Pro v2 — Firebase Edition

This is the fully rebooted version with **Firebase Authentication** and
**Cloud Firestore** replacing the previous SQLite/JSON backend.

---

## What was wrong with the original login & what's fixed

### Bug 1 — Management login was case-sensitive (and confusing)
The old server compared the typed name against a `username` column with an
exact SQL match. If you typed `Admin` instead of `admin` it returned null.
**Fix:** Firebase Auth uses **email + password** — no username matching, no
case issues. The role is stored in Firestore `users/{uid}.role` and is checked
after a successful Firebase sign-in.

### Bug 2 — Customers had no real accounts
Any name + the shared password `customer123` would let you "log in", meaning
you could impersonate any other customer just by typing their name.
**Fix:** Every customer now has a **real Firebase Auth account** (email +
password). The booking query filters by `customerUid == auth.uid`, so you
can only ever see your own jobs.

### Bug 3 — Sessions lived in server memory only
Refreshing the page logged you out. **Fix:** Firebase Auth persists the session
in the browser automatically and the `onAuthStateChanged` observer restores it
on every page load.

---

## Firebase setup (one-time, ~5 minutes)

1. Go to **https://console.firebase.google.com** and create a project
   (e.g. `bugbuster-pro`). A free Spark plan is enough.

2. **Enable Authentication**
   - Build → Authentication → Get started
   - Sign-in method → Email/Password → Enable → Save

3. **Create Firestore Database**
   - Build → Firestore Database → Create database
   - Choose **Start in test mode** (for development — secures later with `firestore.rules`)
   - Pick any region

4. **Get your web app config**
   - Project Settings (⚙️) → Your apps → Add app → Web (</> icon)
   - Register the app (nickname e.g. `bugbuster-web`)
   - Copy the `firebaseConfig` object shown

5. **Paste the config** into `public/firebase-config.js`:
   ```js
   const firebaseConfig = {
     apiKey:            "AIza...",
     authDomain:        "bugbuster-pro.firebaseapp.com",
     projectId:         "bugbuster-pro",
     storageBucket:     "bugbuster-pro.appspot.com",
     messagingSenderId: "123456789",
     appId:             "1:123456789:web:abc123"
   };
   ```

6. **Create the two demo accounts** in Firebase Console:
   - Authentication → Users → Add user
     - Email: `admin@bugbuster.com`    Password: `admin123`
     - Email: `customer@bugbuster.com` Password: `customer123`

7. **Add the role documents** in Firestore Console:
   - After creating each user, copy their **UID** from the Authentication tab
   - Firestore → Start collection → Collection ID: `users`
   - Add document with ID = the admin UID:
     ```
     role:        management
     displayName: Admin
     email:       admin@bugbuster.com
     ```
   - Add document with ID = the customer UID:
     ```
     role:        customer
     displayName: Jane Cooper
     email:       customer@bugbuster.com
     ```

8. **Run the app**
   ```bash
   cd bugbuster-pro-firebase
   npm start        # or: node server.js
   ```
   Open **http://localhost:3000**. On first sign-in as Jane Cooper, the app
   auto-seeds the technicians and three sample bookings into Firestore.

---

## Project structure

```
bugbuster-pro-firebase/
├── server.js              # Minimal static file server (no backend logic)
├── package.json
├── firestore.rules        # Firestore security rules (optional deploy)
├── README.md
└── public/
    ├── index.html         # App shell + Firebase SDK scripts
    ├── styles.css         # Flat UI design system
    ├── firebase-config.js # ← FILL IN YOUR CONFIG HERE
    └── app.js             # All Firebase Auth + Firestore logic
```

---

## How login works now (RBAC flow)

```
User types email + password + selects role button
        ↓
Firebase Auth.signInWithEmailAndPassword()
        ↓  (fails → friendly error shown, NO alert())
Firestore: read users/{uid}
        ↓
Check: users/{uid}.role === selected role button?
  NO  → sign out + show error "This account is registered as …"
  YES → route to Customer or Management dashboard
        ↓
Customer: query bookings WHERE customerUid == uid  (can't see others)
Management: query ALL bookings
```

---

## Creating new customer accounts

Customers can self-register on the landing page (Create account tab). The app
creates a Firebase Auth account and writes `role: customer` to Firestore.
Management accounts must be created manually in the Firebase Console.

---

## Firestore data model (ERD)

```
COLLECTION: users
  {uid} → { email, role, displayName }

COLLECTION: technicians
  {id} → { name, isAvailable }

COLLECTION: bookings
  {id} → {
    customerUid           (→ Firebase Auth uid)
    customerName, address, phone
    pestType, preferredDate, notes
    status                ('Pending' | 'En Route' | 'Completed')
    assignedTechnicianId  (→ technicians/{id})
    technicianName
    feedbackRating, feedbackDescription
    reportChemicals, reportAreas, reportRecommendations
    refundStatus, refundReason
    createdAt
  }
```

Relationships:
- `bookings.customerUid` → `Firebase Auth uid` → `users/{uid}`
- `bookings.assignedTechnicianId` → `technicians/{id}`

---

## SAD concept mapping

| Concept              | Location in code                                                    |
|----------------------|---------------------------------------------------------------------|
| Input Design         | `index.html` forms; `app.js` `submitBooking()`, `doRegister()`      |
| Output Design        | `app.js` `renderCustomerTable()`, `renderMgmtTable()`, badge helpers|
| Control Mechanism    | `app.js` validation blocks + Firebase Auth error mapping            |
| Database / ERD       | Firestore collections in `app.js` `COL_*` + `maybeSeedDatabase()`   |
| Quality Management   | RBAC in `doLogin()`, `onAuthStateChanged`, `esc()`, `runTransaction`|

---

## Demo accounts (after Firebase setup)

| Role       | Email                        | Password    |
|------------|------------------------------|-------------|
| Customer   | customer@bugbuster.com       | customer123 |
| Management | admin@bugbuster.com          | admin123    |

You can also register new customer accounts from the landing page.
