# BugBuster Pro v2 — Firebase Edition

Pest-control booking & dispatch prototype using **Firebase Authentication**
and **Cloud Firestore**. The server is just a static file host — all auth and
data live in Firebase.

> The two demo accounts (management + customer) are **created automatically**
> the first time you open the app. You do **not** need to add users or role
> documents by hand in the Firebase Console.

---

## Quick start (≈3 minutes)

You only need to do the Firebase project setup once. After that, just run and open.

### 1. Create a Firebase project
Go to **https://console.firebase.google.com** → Add project (the free Spark
plan is enough). You can also reuse the project already filled into
`public/firebase-config.js`.

### 2. Enable Email/Password sign-in  ← required
Build → **Authentication** → Get started → Sign-in method →
**Email/Password** → Enable → Save.

(If this is off, account creation/login will fail with
*"Email/Password sign-in is not enabled"*.)

### 3. Create the Firestore database
Build → **Firestore Database** → Create database → **Start in test mode**
→ pick a region.

> Test mode keeps things simple while developing. When you're ready to lock it
> down, deploy the included `firestore.rules` (see *Security rules* below).

### 4. (Optional) Use your own Firebase config
Open `public/firebase-config.js` and paste your project's `firebaseConfig`
object if you're not using the one provided.

### 5. Run the app
```bash
cd bugbuster-pro-firebase
npm start          # or: node server.js
```
Open **http://localhost:3000**.

On first load the app shows *"Preparing demo accounts…"* for a moment while it
creates the two accounts below and their role documents in Firestore, then
drops you on the sign-in screen.

---

## Demo accounts (auto-created on first run)

| Role       | Email                    | Password    |
|------------|--------------------------|-------------|
| Management | `admin@bugbuster.com`    | `admin123`  |
| Customer   | `customer@bugbuster.com` | `customer123` |

Pick the matching role button on the sign-in screen, enter the email +
password, and you're in. You can also **register new customer accounts** from
the "Create account" tab — those go straight into Firebase with
`role: customer`, no extra steps.

The first time you sign in as the customer, the app auto-seeds three sample
bookings and the technician roster so the dashboards aren't empty.

---

## How login works (RBAC flow)

```
Pick role button + enter email/password → Sign in
        ↓
Firebase Auth.signInWithEmailAndPassword()      (friendly error on failure)
        ↓
Read users/{uid}  → role
        ↓
role === selected role button?
   NO  → sign out + "wrong portal" message
   YES → Customer dashboard  (bookings WHERE customerUid == uid)
         or Management dashboard (all bookings)
```

The session is persisted by Firebase, so a page refresh keeps you signed in
(`onAuthStateChanged` restores it).

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
    ├── firebase-config.js # Your Firebase config + SDK init
    └── app.js             # All Auth + Firestore logic
```

---

## Firestore data model (ERD)

```
COLLECTION: users
  {uid} → { email, role, displayName, seededSamples? }

COLLECTION: technicians
  {id} → { name, isAvailable }

COLLECTION: bookings
  {id} → {
    customerUid           (→ Firebase Auth uid)
    customerName, address, phone
    pestType, preferredDate, notes
    code                  (short human-friendly reference, e.g. BK048213)
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

| Concept              | Location in code                                                       |
|----------------------|------------------------------------------------------------------------|
| Input Design         | `index.html` forms; `app.js` `submitBooking()`, `doRegister()`         |
| Output Design        | `app.js` `renderCustomerTable()`, `renderMgmtTable()`, badge helpers   |
| Control Mechanism    | `app.js` validation blocks + `authMessage()` Auth error mapping        |
| Database / ERD       | Firestore collections `COL_*` + `maybeSeedDatabase()`                  |
| Quality Management   | RBAC in `handleAuthChange()`/`doLogin()`, `esc()`, `runTransaction`    |

---

## Security rules (optional, for production)

While in test mode everything is open. To lock the prototype down:

```bash
firebase deploy --only firestore:rules
```

The included `firestore.rules` restricts bookings so customers can read only
their own, and limits technician/role writes appropriately.

> **Prototype note:** for convenience, `app.js` self-creates a user's role
> document on first login if one doesn't exist, and the demo-account routine
> creates a `management` account automatically. For a real deployment, remove
> the auto-provisioning (`ensureDemoAccounts`) and create management accounts
> manually so roles can't be self-assigned.

---

## Resetting the demo

- The "create demo accounts" step runs once per browser (tracked in
  `localStorage` under `bb_demo_seeded`). Clear site data to run it again.
- To wipe data, delete the `users`, `technicians`, and `bookings` collections
  in the Firestore Console (and the demo users under Authentication).
