'use strict';
/* =============================================================
   BUGBUSTER PRO v2 — Firebase Auth + Firestore frontend logic
   Rewritten to match index.html + firebase-config.js (compat SDK).

   SAD concept mapping (for the report):
     Input Design       -> submitBooking(), doRegister(), modal forms
     Output Design      -> renderCustomerTable(), renderMgmtTable(), badges
     Control Mechanism  -> validation blocks + Firebase Auth error mapping
     Database / ERD     -> COL_* collections + maybeSeedDatabase()
     Quality Management -> RBAC (doLogin/onAuthStateChanged), esc(), runTransaction
   ============================================================= */

/* ---------- Firebase handles (initialised in firebase-config.js) ---------- */
const db   = firebase.firestore();
const auth = firebase.auth();

const COL_USERS    = 'users';
const COL_TECHS    = 'technicians';
const COL_BOOKINGS = 'bookings';

/* ---------- App state (UI only — Firestore is the source of truth) -------- */
let selectedRole = 'customer'; // which role button is highlighted
let pendingRole  = null;       // role expected by an in-progress doLogin()
let busyRegister = false;      // suppress the auth observer during registration
let me           = null;       // { uid, email, role, displayName }

/* =============================================================
   DOM + STRING HELPERS
   ============================================================= */
const $ = id => document.getElementById(id);
function show(id) { const e = $(id); if (e) e.classList.remove('hidden'); }
function hide(id) { const e = $(id); if (e) e.classList.add('hidden'); }
function setText(id, t) { const e = $(id); if (e) e.textContent = t; }

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function todayStr() {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function banner(id, title, items) {
  const el = $(id); if (!el) return;
  let html = '<strong>' + esc(title) + '</strong>';
  if (items && items.length) html += '<ul>' + items.map(i => '<li>' + esc(i) + '</li>').join('') + '</ul>';
  el.innerHTML = html; el.classList.remove('hidden');
}
function clearBanner(id) { const el = $(id); if (el) { el.classList.add('hidden'); el.innerHTML = ''; } }
function spin(spinnerId, on) { const s = $(spinnerId); if (s) s.classList.toggle('hidden', !on); }

function statusBadge(s) {
  const m = { 'Pending': 'badge-pending', 'En Route': 'badge-enroute', 'Completed': 'badge-completed' };
  return '<span class="badge ' + (m[s] || 'badge-none') + '">' + esc(s || '—') + '</span>';
}
function refundBadge(s) {
  const m = { 'Requested': 'badge-requested', 'Approved': 'badge-approved', 'Denied': 'badge-denied' };
  return '<span class="badge ' + (m[s] || 'badge-none') + '">' + esc(s || 'None') + '</span>';
}
function readStars(n) {
  n = n || 0; let h = '<span class="stars read">';
  for (let i = 1; i <= 5; i++) h += '<span class="star ' + (i <= n ? 'on' : '') + '">&#9733;</span>';
  return h + '</span>';
}
function tableHTML(headers, rowsHTML, colspan) {
  const head = '<tr>' + headers.map(h => '<th>' + h + '</th>').join('') + '</tr>';
  const body = rowsHTML || ('<tr class="empty-row"><td colspan="' + (colspan || headers.length) + '">No records.</td></tr>');
  return '<div class="table-wrap"><table><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>';
}

/* Friendly mapping of Firebase Auth error codes (Control Mechanism). */
function authMessage(err) {
  switch ((err && err.code) || '') {
    case 'auth/invalid-email':          return 'That email address looks invalid.';
    case 'auth/user-disabled':          return 'This account has been disabled.';
    case 'auth/user-not-found':         return 'No account found with that email.';
    case 'auth/wrong-password':
    case 'auth/invalid-credential':     return 'Incorrect email or password.';
    case 'auth/too-many-requests':      return 'Too many attempts. Please wait a moment and try again.';
    case 'auth/email-already-in-use':   return 'An account with that email already exists.';
    case 'auth/weak-password':          return 'Password should be at least 6 characters.';
    case 'auth/network-request-failed': return 'Network error — check your connection.';
    default: return (err && err.message) || 'Something went wrong. Please try again.';
  }
}

/* =============================================================
   SCREENS / ROUTING / SMALL UI
   ============================================================= */
function showScreen(which) {
  ['loading', 'landing', 'customer', 'management'].forEach(s => hide('screen-' + s));
  show('screen-' + which);
  window.scrollTo(0, 0);
}
function setLoading(msg) { showScreen('loading'); setText('loadingMsg', msg || 'Loading…'); }

function switchTab(which) {
  const login = which === 'login';
  $('tabLogin').classList.toggle('active', login);
  $('tabRegister').classList.toggle('active', !login);
  $('panelLogin').classList.toggle('hidden', !login);
  $('panelRegister').classList.toggle('hidden', login);
}
function selectRole(role) {
  selectedRole = role;
  $('roleCustomerBtn').classList.toggle('active', role === 'customer');
  $('roleManagementBtn').classList.toggle('active', role === 'management');
  clearBanner('loginError');
}
function togglePw(id, btn) {
  const el = $(id); if (!el) return;
  const showing = el.type === 'text';
  el.type = showing ? 'password' : 'text';
  if (btn) btn.textContent = showing ? '👁' : '🙈';
}

/* ---------- Modal ---------- */
function openModal(html) { $('modalBox').innerHTML = html; show('modalOverlay'); }
function closeModal() { hide('modalOverlay'); $('modalBox').innerHTML = ''; }
function handleOverlayClick(e) { if (e.target === $('modalOverlay')) closeModal(); }
function openInfo(title, msg) {
  openModal('<h2>' + esc(title) + '</h2><p class="sub">' + esc(msg) + '</p>' +
    '<div class="modal-actions"><button class="btn btn-primary" onclick="closeModal()">OK</button></div>');
}

/* =============================================================
   AUTH OBSERVER — single source of truth for routing + loading
   (Bug 3 fix: Firebase restores the session on every page load.)
   ============================================================= */
async function handleAuthChange(user) {
  if (busyRegister) return; // ignore transitions caused by registration

  if (!user) {
    me = null;
    showScreen('landing');
    switchTab('login');
    return;
  }

  setLoading('Signing in…');
  try {
    // Read the role document. If it doesn't exist yet, self-bootstrap one
    // using the role being signed in as. (Prototype convenience so the app
    // runs without manually creating Firestore docs. Lock this down for prod.)
    const ref = db.collection(COL_USERS).doc(user.uid);
    const snap = await ref.get();
    let role, displayName;
    if (snap.exists) {
      const d = snap.data();
      role = d.role;
      displayName = d.displayName || user.email.split('@')[0];
    } else {
      role = pendingRole || selectedRole || 'customer';
      displayName = user.email.split('@')[0];
      await ref.set({ email: user.email, role: role, displayName: displayName }, { merge: true });
    }

    // RBAC: only enforce the role-button match for an explicit doLogin().
    if (pendingRole && role !== pendingRole) {
      pendingRole = null;
      await auth.signOut();
      banner('loginError', 'Wrong portal for this account',
        ['This account is registered as “' + role + '”. Use the ' + role + ' button to sign in.']);
      spin('loginSpinner', false);
      return;
    }
    pendingRole = null;

    me = { uid: user.uid, email: user.email, role: role, displayName: displayName };
    await maybeSeedDatabase();

    if (role === 'management') {
      setText('mgmtWho', displayName);
      showScreen('management');
      await loadManagement();
    } else {
      setText('custWho', displayName);
      prepCustomerForm();
      showScreen('customer');
      await loadCustomerBookings();
    }
  } catch (err) {
    console.error(err);
    showScreen('landing');
    banner('loginError', 'Could not complete sign-in', [authMessage(err)]);
  } finally {
    spin('loginSpinner', false);
  }
}

/* =============================================================
   LOGIN / REGISTER / LOGOUT
   ============================================================= */
async function doLogin() {
  clearBanner('loginError');
  const email = $('loginEmail').value.trim();
  const password = $('loginPass').value;

  const errs = [];
  if (!email) errs.push('Email is required.');
  if (!password) errs.push('Password is required.');
  if (!selectedRole) errs.push('Choose Customer or Management.');
  if (errs.length) { banner('loginError', 'Please check the form:', errs); return; }

  pendingRole = selectedRole;
  spin('loginSpinner', true);
  try {
    await auth.signInWithEmailAndPassword(email, password);
    // Routing + role check happen in handleAuthChange().
  } catch (err) {
    pendingRole = null;
    spin('loginSpinner', false);
    banner('loginError', 'Sign in failed', [authMessage(err)]);
  }
}

async function doRegister() {
  clearBanner('regError'); clearBanner('regSuccess');
  const name = $('regName').value.trim();
  const email = $('regEmail').value.trim();
  const pass = $('regPass').value;

  const errs = [];
  if (!name) errs.push('Full name is required.');
  if (!email) errs.push('Email is required.');
  if (!pass || pass.length < 6) errs.push('Password must be at least 6 characters.');
  if (errs.length) { banner('regError', 'Please check the form:', errs); return; }

  busyRegister = true; // stop the observer from auto-routing mid-flow
  spin('regSpinner', true);
  try {
    const cred = await auth.createUserWithEmailAndPassword(email, pass);
    await db.collection(COL_USERS).doc(cred.user.uid).set({
      email: email, role: 'customer', displayName: name
    });
    await auth.signOut(); // ask them to sign in (matches the README flow)

    banner('regSuccess', 'Account created!', ['You can now sign in with your email and password.']);
    $('regName').value = ''; $('regEmail').value = ''; $('regPass').value = '';
    switchTab('login');
    selectRole('customer');
    $('loginEmail').value = email;
  } catch (err) {
    banner('regError', 'Could not create account', [authMessage(err)]);
  } finally {
    busyRegister = false;
    spin('regSpinner', false);
  }
}

async function doLogout() {
  try { await auth.signOut(); } catch (_) { /* ignore */ }
  me = null;
  ['custBookingsWrap', 'custFeedbackList', 'mgmtBookingsWrap', 'mgmtRefundsWrap', 'techWrap']
    .forEach(id => { const e = $(id); if (e) e.innerHTML = ''; });
  setText('custWho', '—'); setText('mgmtWho', '—');
  clearBanner('loginError'); clearBanner('bookingError'); clearBanner('bookingSuccess');
  $('loginPass').value = '';
}

/* =============================================================
   DATABASE SEEDING (Database / ERD)
   Technicians: seeded once if empty.
   Sample bookings: seeded once per customer who has none.
   Each part is best-effort and never blocks the dashboard.
   ============================================================= */
async function maybeSeedDatabase() {
  await ensureTechnicians();
  if (me && me.role === 'customer') await ensureSampleBookings();
}

async function ensureTechnicians() {
  try {
    const snap = await db.collection(COL_TECHS).limit(1).get();
    if (!snap.empty) return;
    const batch = db.batch();
    [['tech1', 'Marcus Reed'], ['tech2', 'Priya Singh'], ['tech3', 'Diego Alvarez']]
      .forEach(([id, name]) => batch.set(db.collection(COL_TECHS).doc(id), { name: name, isAvailable: true }));
    await batch.commit();
  } catch (err) { console.warn('Technician seed skipped:', err.message); }
}

async function ensureSampleBookings() {
  try {
    const userRef = db.collection(COL_USERS).doc(me.uid);
    const uSnap = await userRef.get();
    if (uSnap.exists && uSnap.data().seededSamples) return;

    const mine = await db.collection(COL_BOOKINGS).where('customerUid', '==', me.uid).limit(1).get();
    if (!mine.empty) { await userRef.set({ seededSamples: true }, { merge: true }); return; }

    const now = Date.now();
    const samples = [
      { pestType: 'Termite', address: '12 Maple Street', phone: '555-0110', preferredDate: todayStr(),
        notes: 'Wood damage near the porch.', status: 'Pending', technicianName: '', assignedTechnicianId: '' },
      { pestType: 'Rodent', address: '12 Maple Street', phone: '555-0110', preferredDate: todayStr(),
        notes: 'Scratching in the attic at night.', status: 'En Route', technicianName: 'Marcus Reed', assignedTechnicianId: 'tech1' },
      { pestType: 'General', address: '12 Maple Street', phone: '555-0110', preferredDate: todayStr(),
        notes: 'Ants in the kitchen.', status: 'Completed', technicianName: 'Priya Singh', assignedTechnicianId: 'tech2',
        reportChemicals: 'Fipronil 0.05%', reportAreas: 'Kitchen, pantry', reportRecommendations: 'Keep food sealed; follow-up in 3 months.' }
    ];

    const batch = db.batch();
    samples.forEach((s, i) => {
      const ref = db.collection(COL_BOOKINGS).doc();
      batch.set(ref, Object.assign({
        customerUid: me.uid,
        customerName: me.displayName,
        code: 'BK' + String(now + i).slice(-6),
        feedbackRating: 0, feedbackDescription: '',
        reportChemicals: '', reportAreas: '', reportRecommendations: '',
        refundStatus: '', refundReason: '',
        createdAt: now + i
      }, s));
    });
    batch.set(userRef, { seededSamples: true }, { merge: true });
    await batch.commit();
  } catch (err) { console.warn('Sample-booking seed skipped:', err.message); }
}

/* =============================================================
   CUSTOMER — INPUT DESIGN (booking form)
   ============================================================= */
function prepCustomerForm() {
  if ($('bName')) $('bName').value = me ? me.displayName : '';
  if ($('bDate')) $('bDate').setAttribute('min', todayStr());
}

async function submitBooking() {
  clearBanner('bookingError'); clearBanner('bookingSuccess');
  const payload = {
    customerName: $('bName').value.trim(),
    address: $('bAddress').value.trim(),
    phone: $('bPhone').value.trim(),
    pestType: $('bPest').value,
    preferredDate: $('bDate').value,
    notes: $('bNotes').value.trim()
  };

  const errors = [];
  if (!payload.customerName) errors.push('Your name is required.');
  if (!payload.address) errors.push('Service address is required.');
  if (!payload.phone) errors.push('Phone is required.');
  else if (!/[0-9]/.test(payload.phone)) errors.push('Phone should contain digits.');
  if (!payload.pestType) errors.push('Select a pest type.');
  if (!payload.preferredDate) errors.push('Preferred date is required.');
  else if (payload.preferredDate < todayStr()) errors.push('Preferred date cannot be earlier than today.');
  if (errors.length) { banner('bookingError', 'Please fix the following:', errors); return; }

  spin('bookSpinner', true);
  try {
    const now = Date.now();
    await db.collection(COL_BOOKINGS).add(Object.assign(payload, {
      customerUid: me.uid,
      code: 'BK' + String(now).slice(-6),
      status: 'Pending',
      assignedTechnicianId: '', technicianName: '',
      feedbackRating: 0, feedbackDescription: '',
      reportChemicals: '', reportAreas: '', reportRecommendations: '',
      refundStatus: '', refundReason: '',
      createdAt: now
    }));
    ['bAddress', 'bPhone', 'bDate', 'bNotes'].forEach(id => { if ($(id)) $(id).value = ''; });
    $('bPest').value = '';
    banner('bookingSuccess', 'Booking received! It is now Pending and shown on the right.', []);
    await loadCustomerBookings();
  } catch (err) {
    banner('bookingError', 'Could not save the booking:', [authMessage(err)]);
  } finally {
    spin('bookSpinner', false);
  }
}

/* =============================================================
   CUSTOMER — OUTPUT DESIGN (own bookings + feedback)
   ============================================================= */
async function loadCustomerBookings() {
  const wrap = $('custBookingsWrap');
  if (wrap) wrap.innerHTML = '<div class="skeleton-table"></div>';
  try {
    const snap = await db.collection(COL_BOOKINGS).where('customerUid', '==', me.uid).get();
    const rows = snap.docs
      .map(d => Object.assign({ id: d.id }, d.data()))
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    renderCustomerTable(rows);
  } catch (err) {
    if (wrap) wrap.innerHTML = '<div class="banner banner-error">Could not load your bookings: ' + esc(authMessage(err)) + '</div>';
  }
}

function renderCustomerTable(rows) {
  let body = '';
  if (!rows.length) {
    body = '<tr class="empty-row"><td colspan="6">No bookings yet. Use the form to book your first service.</td></tr>';
  } else {
    body = rows.map(b => {
      const hasReport = b.reportChemicals || b.reportAreas;
      const report = hasReport
        ? '<button class="btn btn-ghost btn-sm" onclick="viewServiceReport(\'' + b.id + '\')">View report</button>'
        : '<span class="badge badge-none">—</span>';
      const actions = [];
      if (b.status === 'Completed' && !(b.feedbackRating > 0))
        actions.push('<button class="btn btn-primary btn-sm" onclick="openFeedback(\'' + b.id + '\')">Rate service</button>');
      if (!b.refundStatus)
        actions.push('<button class="btn btn-ghost btn-sm" onclick="openRefund(\'' + b.id + '\')">Request refund</button>');
      else
        actions.push('<span style="margin-left:.2rem;">' + refundBadge(b.refundStatus) + '</span>');
      return '<tr><td>' + esc(b.code || b.id.slice(0, 6)) + '</td><td>' + esc(b.pestType) + '</td><td>' +
        esc(b.preferredDate) + '</td><td>' + statusBadge(b.status) + '</td><td>' + report +
        '</td><td><div class="cell-actions">' + actions.join('') + '</div></td></tr>';
    }).join('');
  }
  $('custBookingsWrap').innerHTML = tableHTML(['Ref', 'Pest', 'Date', 'Status', 'Report', 'Actions'], body, 6);

  const withFb = rows.filter(b => b.feedbackRating > 0);
  const list = $('custFeedbackList');
  if (list) {
    list.innerHTML = withFb.length
      ? withFb.map(b =>
          '<div class="card" style="margin-bottom:.8rem;"><div style="display:flex;justify-content:space-between;align-items:center;gap:1rem;flex-wrap:wrap;"><strong>' +
          esc(b.code || b.id.slice(0, 6)) + ' · ' + esc(b.pestType) + '</strong>' + readStars(b.feedbackRating) +
          '</div><p class="meta-line" style="margin:.4rem 0 0;">' + esc(b.feedbackDescription || 'No comment left.') + '</p></div>'
        ).join('')
      : '<div class="card"><p class="meta-line" style="margin:0;">No feedback yet. Rate a completed service to see it here.</p></div>';
  }
}

/* =============================================================
   CUSTOMER — FEEDBACK (1–5 stars)
   ============================================================= */
let feedbackDraft = { id: null, rating: 0 };
function openFeedback(id) {
  feedbackDraft = { id: id, rating: 0 };
  openModal('<h2>Rate your service</h2><p class="sub">How satisfied were you?</p>' +
    '<div class="stars" id="starPicker">' + starButtons(0) + '</div>' +
    '<div class="field" style="margin-top:1rem;"><label for="fbDesc">Comments</label><textarea id="fbDesc" placeholder="Tell us about the service…"></textarea></div>' +
    '<div id="fbError" class="banner banner-error hidden"></div>' +
    '<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="submitFeedback()">Submit rating</button></div>');
}
function starButtons(active) {
  let h = '';
  for (let i = 1; i <= 5; i++) h += '<button type="button" class="star ' + (i <= active ? 'on' : '') + '" onclick="setStar(' + i + ')">&#9733;</button>';
  return h;
}
function setStar(n) { feedbackDraft.rating = n; $('starPicker').innerHTML = starButtons(n); }
async function submitFeedback() {
  if (!feedbackDraft.rating) { banner('fbError', 'Please choose a star rating (1–5).', []); return; }
  try {
    await db.collection(COL_BOOKINGS).doc(feedbackDraft.id).update({
      feedbackRating: feedbackDraft.rating,
      feedbackDescription: ($('fbDesc').value || '').trim()
    });
    closeModal(); await loadCustomerBookings();
  } catch (err) { banner('fbError', 'Could not save feedback:', [authMessage(err)]); }
}

/* =============================================================
   CUSTOMER — REFUND REQUEST
   ============================================================= */
let refundDraftId = null;
function openRefund(id) {
  refundDraftId = id;
  openModal('<h2>Request a refund</h2><p class="sub">Tell us why you’re requesting a refund.</p>' +
    '<div class="field"><label for="rfReason">Reason <span class="req">*</span></label><textarea id="rfReason" placeholder="Describe the issue…"></textarea></div>' +
    '<div id="rfError" class="banner banner-error hidden"></div>' +
    '<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="submitRefund()">Submit request</button></div>');
}
async function submitRefund() {
  const reason = ($('rfReason').value || '').trim();
  if (!reason) { banner('rfError', 'A reason is required to request a refund.', []); return; }
  try {
    await db.collection(COL_BOOKINGS).doc(refundDraftId).update({ refundStatus: 'Requested', refundReason: reason });
    closeModal(); await loadCustomerBookings();
  } catch (err) { banner('rfError', 'Could not submit refund:', [authMessage(err)]); }
}

/* =============================================================
   MANAGEMENT — INTERNAL OUTPUT + MASTER TABLES
   ============================================================= */
async function loadManagement() {
  ['mgmtBookingsWrap', 'mgmtRefundsWrap', 'techWrap'].forEach(id => { const e = $(id); if (e) e.innerHTML = '<div class="skeleton-table"></div>'; });
  $('summaryCards').innerHTML = '<div class="stat skeleton-stat"></div>'.repeat(4);
  try {
    const [bSnap, tSnap] = await Promise.all([
      db.collection(COL_BOOKINGS).get(),
      db.collection(COL_TECHS).get()
    ]);
    const bookings = bSnap.docs.map(d => Object.assign({ id: d.id }, d.data())).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const techs = tSnap.docs.map(d => Object.assign({ id: d.id }, d.data()));
    renderMgmtTable(bookings, techs);
  } catch (err) {
    $('summaryCards').innerHTML = '';
    $('mgmtBookingsWrap').innerHTML = '<div class="banner banner-error">Could not load bookings: ' + esc(authMessage(err)) + '</div>';
    $('mgmtRefundsWrap').innerHTML = '';
    $('techWrap').innerHTML = '';
  }
}

function renderMgmtTable(bookings, techs) {
  // Summary cards
  const active = bookings.filter(b => b.status === 'Pending' || b.status === 'En Route').length;
  const free = techs.filter(t => t.isAvailable).length;
  const pendingRefunds = bookings.filter(b => b.refundStatus === 'Requested').length;
  $('summaryCards').innerHTML =
    '<div class="stat info"><div class="num">' + active + '</div><div class="lbl">Active jobs (Pending + En Route)</div></div>' +
    '<div class="stat"><div class="num">' + free + '</div><div class="lbl">Available technicians</div></div>' +
    '<div class="stat warn"><div class="num">' + bookings.length + '</div><div class="lbl">Total bookings</div></div>' +
    '<div class="stat danger"><div class="num">' + pendingRefunds + '</div><div class="lbl">Refunds awaiting review</div></div>';

  // Master bookings table
  const anyFree = techs.some(t => t.isAvailable);
  let bbody = '';
  if (!bookings.length) {
    bbody = '<tr class="empty-row"><td colspan="7">No bookings in the system.</td></tr>';
  } else {
    bbody = bookings.map(b => {
      const actions = [];
      if (b.status === 'Pending')
        actions.push('<button class="btn btn-primary btn-sm" onclick="assignTechnician(\'' + b.id + '\')"' + (anyFree ? '' : ' disabled') + '>' + (anyFree ? 'Assign tech' : 'No tech free') + '</button>');
      if (b.status === 'En Route')
        actions.push('<button class="btn btn-ghost btn-sm" onclick="completeJob(\'' + b.id + '\')">Mark completed</button>');
      if (b.status === 'Completed')
        actions.push('<button class="btn btn-ghost btn-sm" onclick="openServiceReport(\'' + b.id + '\')">' + ((b.reportChemicals || b.reportAreas) ? 'Edit report' : 'Create report') + '</button>');
      const tech = b.technicianName ? esc(b.technicianName) : '<span class="badge badge-none">Unassigned</span>';
      return '<tr><td>' + esc(b.code || b.id.slice(0, 6)) + '</td><td>' + esc(b.customerName) + '</td><td>' +
        esc(b.pestType) + '</td><td>' + esc(b.preferredDate) + '</td><td>' + statusBadge(b.status) + '</td><td>' +
        tech + '</td><td><div class="cell-actions">' + (actions.join('') || '<span class="meta-line">—</span>') + '</div></td></tr>';
    }).join('');
  }
  $('mgmtBookingsWrap').innerHTML = tableHTML(['Ref', 'Customer', 'Pest', 'Date', 'Status', 'Technician', 'Actions'], bbody, 7);

  // Refund requests table
  const reqs = bookings.filter(b => b.refundStatus);
  let rbody = '';
  if (!reqs.length) {
    rbody = '<tr class="empty-row"><td colspan="5">No refund requests.</td></tr>';
  } else {
    rbody = reqs.map(b => {
      let decision = '<span class="meta-line">' + esc(b.refundStatus) + '</span>';
      if (b.refundStatus === 'Requested') {
        decision = '<div class="cell-actions"><button class="btn btn-primary btn-sm" onclick="decideRefund(\'' + b.id + '\', true)">Approve</button>' +
          '<button class="btn btn-danger btn-sm" onclick="decideRefund(\'' + b.id + '\', false)">Deny</button></div>';
      }
      return '<tr><td>' + esc(b.code || b.id.slice(0, 6)) + '</td><td>' + esc(b.customerName) + '</td><td>' +
        esc(b.refundReason) + '</td><td>' + refundBadge(b.refundStatus) + '</td><td>' + decision + '</td></tr>';
    }).join('');
  }
  $('mgmtRefundsWrap').innerHTML = tableHTML(['Ref', 'Customer', 'Reason', 'Status', 'Decision'], rbody, 5);

  // Technician roster
  const tbody = techs.length
    ? techs.map(t => '<tr><td>' + esc(t.id) + '</td><td>' + esc(t.name) + '</td><td>' +
        (t.isAvailable ? '<span class="badge badge-completed">Available</span>' : '<span class="badge badge-enroute">On a job</span>') + '</td></tr>').join('')
    : '<tr class="empty-row"><td colspan="3">No technicians.</td></tr>';
  $('techWrap').innerHTML = tableHTML(['ID', 'Name', 'Status'], tbody, 3);
}

/* ---------- Management actions (Quality Management: runTransaction) ---------- */
async function assignTechnician(bookingId) {
  try {
    const techSnap = await db.collection(COL_TECHS).where('isAvailable', '==', true).limit(1).get();
    if (techSnap.empty) { openInfo('Could not assign', 'No technician is currently available.'); return; }
    const techDoc = techSnap.docs[0];
    const techRef = techDoc.ref;
    const bookingRef = db.collection(COL_BOOKINGS).doc(bookingId);

    await db.runTransaction(async tx => {
      const tSnap = await tx.get(techRef);
      const bSnap = await tx.get(bookingRef);
      if (!tSnap.exists || !tSnap.data().isAvailable) throw new Error('Technician is no longer available.');
      if (!bSnap.exists || bSnap.data().status !== 'Pending') throw new Error('Booking is not pending anymore.');
      tx.update(bookingRef, { status: 'En Route', assignedTechnicianId: techDoc.id, technicianName: tSnap.data().name });
      tx.update(techRef, { isAvailable: false });
    });
    await loadManagement();
  } catch (err) { openInfo('Could not assign', err.message || 'Try again.'); }
}

async function completeJob(bookingId) {
  try {
    const bookingRef = db.collection(COL_BOOKINGS).doc(bookingId);
    await db.runTransaction(async tx => {
      const bSnap = await tx.get(bookingRef);
      if (!bSnap.exists) throw new Error('Booking not found.');
      const data = bSnap.data();
      let techRef = null, techSnap = null;
      if (data.assignedTechnicianId) {
        techRef = db.collection(COL_TECHS).doc(data.assignedTechnicianId);
        techSnap = await tx.get(techRef); // reads must precede writes in a transaction
      }
      tx.update(bookingRef, { status: 'Completed' });
      if (techRef && techSnap && techSnap.exists) tx.update(techRef, { isAvailable: true });
    });
    await loadManagement();
  } catch (err) { openInfo('Could not complete', err.message || 'Try again.'); }
}

async function decideRefund(bookingId, approve) {
  try {
    await db.collection(COL_BOOKINGS).doc(bookingId).update({ refundStatus: approve ? 'Approved' : 'Denied' });
    await loadManagement();
  } catch (err) { openInfo('Could not update refund', err.message || 'Try again.'); }
}

/* =============================================================
   MANAGEMENT — DIGITAL SERVICE REPORT
   ============================================================= */
let reportDraftId = null;
async function openServiceReport(bookingId) {
  reportDraftId = bookingId;
  try {
    const snap = await db.collection(COL_BOOKINGS).doc(bookingId).get();
    const b = snap.data() || {};
    openModal('<h2>Service report</h2><p class="sub">' + esc(b.customerName || '') + ' · ' + esc(b.pestType || '') + '</p>' +
      '<div class="field"><label for="srChem">Chemicals used <span class="req">*</span></label><textarea id="srChem" placeholder="e.g. Fipronil 0.05%, bait stations">' + esc(b.reportChemicals || '') + '</textarea></div>' +
      '<div class="field"><label for="srAreas">Areas treated <span class="req">*</span></label><textarea id="srAreas" placeholder="e.g. Kitchen, garage, perimeter">' + esc(b.reportAreas || '') + '</textarea></div>' +
      '<div class="field"><label for="srRec">Recommendations</label><textarea id="srRec" placeholder="Follow-up advice for the customer">' + esc(b.reportRecommendations || '') + '</textarea></div>' +
      '<div id="srError" class="banner banner-error hidden"></div>' +
      '<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveServiceReport()">Save report</button></div>');
  } catch (err) { openInfo('Could not open report', authMessage(err)); }
}
async function saveServiceReport() {
  const chem = ($('srChem').value || '').trim();
  const areas = ($('srAreas').value || '').trim();
  const rec = ($('srRec').value || '').trim();
  const errors = [];
  if (!chem) errors.push('List the chemicals used.');
  if (!areas) errors.push('List the areas treated.');
  if (errors.length) { banner('srError', 'Please complete the report:', errors); return; }
  try {
    await db.collection(COL_BOOKINGS).doc(reportDraftId).update({
      reportChemicals: chem, reportAreas: areas, reportRecommendations: rec
    });
    closeModal(); await loadManagement();
  } catch (err) { banner('srError', 'Could not save report:', [authMessage(err)]); }
}
async function viewServiceReport(bookingId) {
  try {
    const snap = await db.collection(COL_BOOKINGS).doc(bookingId).get();
    const b = snap.data(); if (!b) return;
    openModal('<h2>Service report</h2><p class="sub">' + esc(b.pestType || '') + '</p>' +
      '<h3>Chemicals used</h3><p class="meta-line">' + esc(b.reportChemicals || '—') + '</p>' +
      '<h3 style="margin-top:.8rem;">Areas treated</h3><p class="meta-line">' + esc(b.reportAreas || '—') + '</p>' +
      '<h3 style="margin-top:.8rem;">Recommendations</h3><p class="meta-line">' + esc(b.reportRecommendations || 'None provided.') + '</p>' +
      '<div class="modal-actions"><button class="btn btn-primary" onclick="closeModal()">Close</button></div>');
  } catch (err) { openInfo('Could not open report', authMessage(err)); }
}

/* =============================================================
   WIRING — expose handlers, set defaults, start the observer
   ============================================================= */
Object.assign(window, {
  switchTab, selectRole, togglePw, doLogin, doRegister, doLogout,
  submitBooking, loadCustomerBookings, loadManagement,
  handleOverlayClick, closeModal,
  openFeedback, setStar, submitFeedback,
  openRefund, submitRefund,
  assignTechnician, completeJob, decideRefund,
  openServiceReport, saveServiceReport, viewServiceReport
});

// Default landing UI state.
selectRole('customer');
switchTab('login');

// Single router: decides landing vs dashboard and always dismisses loading.
auth.onAuthStateChanged(handleAuthChange);

// Safety net: never let the loading screen hang forever (e.g. bad config / offline).
setTimeout(() => {
  const loading = $('screen-loading');
  if (loading && !loading.classList.contains('hidden') && !auth.currentUser) {
    showScreen('landing');
    banner('loginError', 'Still connecting…',
      ['If this keeps happening, re-check your Firebase config and your internet connection.']);
  }
}, 8000);
