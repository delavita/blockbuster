'use strict';
/* =============================================================
   BUGBUSTER PRO — Frontend app (Firebase Auth + Firestore)
   SAD concept markers:
     [INPUT]    — Input Design
     [OUTPUT]   — Output Design
     [CONTROL]  — Control Mechanism / validation
     [DB]       — Database / Firestore operations (ERD)
     [QM]       — Quality Management / RBAC / error handling
   ============================================================= */

// ── Firestore collection references  [DB]
const COL_USERS       = () => fbDb.collection('users');
const COL_BOOKINGS    = () => fbDb.collection('bookings');
const COL_TECHNICIANS = () => fbDb.collection('technicians');

// ── Seed data (written to Firestore on very first load)  [DB]
const SEED_TECHNICIANS = [
  { name: 'Marcus Reed',    isAvailable: true  },
  { name: 'Priya Nair',     isAvailable: true  },
  { name: 'Diego Santos',   isAvailable: false },
  { name: 'Lena Kowalski',  isAvailable: true  },
];

function offsetDate(days) {
  const d = new Date(); d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/* =============================================================
   [QM] UTILITY HELPERS
   ============================================================= */
const $ = id => document.getElementById(id);
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
function todayStr() { return new Date().toISOString().slice(0, 10); }

function showBanner(id, title, items) {
  const el = $(id); if (!el) return;
  let html = '<strong>' + esc(title) + '</strong>';
  if (items && items.length) html += '<ul>' + items.map(i => '<li>' + esc(i) + '</li>').join('') + '</ul>';
  el.innerHTML = html; el.classList.remove('hidden');
}
function hideBanner(id) { const el = $(id); if (el) el.classList.add('hidden'); }
function showScreen(which) {
  ['loading','landing','customer','management'].forEach(s => $('screen-' + s).classList.add('hidden'));
  $('screen-' + which).classList.remove('hidden');
  window.scrollTo(0, 0);
}
function setLoading(msg) { if ($('loadingMsg')) $('loadingMsg').textContent = msg; }

// Button loading state helpers
function btnBusy(id, busy) {
  const b = $(id); if (!b) return;
  b.disabled = busy;
  const sp = b.querySelector('.spinner');
  if (sp) sp.classList.toggle('hidden', !busy);
}

// [QM] Password show/toggle
window.togglePw = function(inputId, btn) {
  const inp = $(inputId);
  if (!inp) return;
  inp.type = inp.type === 'password' ? 'text' : 'password';
  btn.textContent = inp.type === 'password' ? '👁' : '🙈';
};

/* =============================================================
   MODAL — replaces all native alert/confirm/prompt  [QM]
   ============================================================= */
function openModal(html) {
  $('modalBox').innerHTML = html;
  $('modalOverlay').classList.remove('hidden');
}
function closeModal() {
  $('modalOverlay').classList.add('hidden');
  $('modalBox').innerHTML = '';
}
window.closeModal = closeModal;

window.handleOverlayClick = function(e) {
  if (e.target === $('modalOverlay')) closeModal();
};

/* =============================================================
   [DB] FIRST-RUN SEEDING
   Writes technicians + 3 seed bookings to Firestore once.
   Checks for a sentinel doc 'meta/seeded' to avoid repeating.
   ============================================================= */
async function maybeSeedDatabase(customerUid) {
  const sentinel = fbDb.doc('meta/seeded');
  const snap = await sentinel.get();
  if (snap.exists) return;

  setLoading('Seeding demo data…');
  const batch = fbDb.batch();

  // Technicians
  const techRefs = [];
  for (const t of SEED_TECHNICIANS) {
    const ref = COL_TECHNICIANS().doc();
    batch.set(ref, t);
    techRefs.push(ref.id);
  }

  // Seed bookings (use the first customer uid so they show up for Jane Cooper)
  const seedBookings = [
    { customerName: 'Jane Cooper', customerUid, address: '12 Maple St, Springfield',
      phone: '555-0101', pestType: 'Termite', preferredDate: offsetDate(3),
      notes: 'Back deck affected', status: 'Pending', assignedTechnicianId: null,
      technicianName: null, feedbackRating: null, feedbackDescription: null,
      reportChemicals: null, reportAreas: null, reportRecommendations: null,
      refundStatus: null, refundReason: null, createdAt: firebase.firestore.FieldValue.serverTimestamp() },
    { customerName: 'Jane Cooper', customerUid, address: '12 Maple St, Springfield',
      phone: '555-0101', pestType: 'Rodent', preferredDate: offsetDate(1),
      notes: '', status: 'En Route', assignedTechnicianId: techRefs[2],
      technicianName: 'Diego Santos', feedbackRating: null, feedbackDescription: null,
      reportChemicals: null, reportAreas: null, reportRecommendations: null,
      refundStatus: null, refundReason: null, createdAt: firebase.firestore.FieldValue.serverTimestamp() },
    { customerName: 'Sam Lee', customerUid: 'seed-sam', address: '88 Oak Ave, Springfield',
      phone: '555-0199', pestType: 'General', preferredDate: offsetDate(-5),
      notes: 'Quarterly service', status: 'Completed', assignedTechnicianId: null,
      technicianName: null, feedbackRating: 5, feedbackDescription: 'Punctual and very thorough.',
      reportChemicals: 'Fipronil 0.05%, boric acid bait',
      reportAreas: 'Kitchen, garage, perimeter',
      reportRecommendations: 'Re-inspect in 3 months; seal garage gap.',
      refundStatus: null, refundReason: null, createdAt: firebase.firestore.FieldValue.serverTimestamp() },
  ];
  for (const b of seedBookings) batch.set(COL_BOOKINGS().doc(), b);

  // Mark seeded
  batch.set(sentinel, { at: firebase.firestore.FieldValue.serverTimestamp() });
  await batch.commit();
}

/* =============================================================
   RBAC — current session  [QM]
   ============================================================= */
let currentUser  = null;   // Firebase Auth user
let currentRole  = null;   // 'customer' | 'management'
let selectedRole = 'customer';

/* =============================================================
   LANDING — role selector + tab switcher
   ============================================================= */
window.selectRole = function(role) {
  selectedRole = role;
  $('roleCustomerBtn').classList.toggle('active', role === 'customer');
  $('roleManagementBtn').classList.toggle('active', role === 'management');
  hideBanner('loginError');
};

window.switchTab = function(tab) {
  $('tabLogin').classList.toggle('active', tab === 'login');
  $('tabRegister').classList.toggle('active', tab === 'register');
  $('panelLogin').classList.toggle('hidden', tab !== 'login');
  $('panelRegister').classList.toggle('hidden', tab === 'login');
};

/* =============================================================
   [INPUT] / [CONTROL] — LOGIN via Firebase Auth
   Fixes the original bug: email+password (no case-sensitivity
   issue), role is verified from Firestore users/{uid}.role.
   ============================================================= */
window.doLogin = async function() {
  hideBanner('loginError');
  const email    = $('loginEmail').value.trim();
  const password = $('loginPass').value;

  // [CONTROL] client-side check first
  const errs = [];
  if (!email)    errs.push('Email is required.');
  if (!password) errs.push('Password is required.');
  if (errs.length) { showBanner('loginError', 'Please fix:', errs); return; }

  btnBusy('loginBtn', true);
  try {
    const cred = await fbAuth.signInWithEmailAndPassword(email, password);
    const uid  = cred.user.uid;

    // [DB] read role from Firestore
    const userDoc = await COL_USERS().doc(uid).get();
    if (!userDoc.exists) throw new Error('Account not found in system. Contact admin.');

    const userData = userDoc.data();
    const role     = userData.role;

    // [QM] RBAC: enforce that the role button matches the Firestore role
    if (role !== selectedRole) {
      await fbAuth.signOut();
      throw new Error(
        'This account is registered as "' + role + '". ' +
        'Please select the "' + (role === 'management' ? 'Management' : 'Customer') + '" role button.'
      );
    }

    currentUser = cred.user;
    currentRole = role;
    await routeUser(userData);
  } catch (e) {
    showBanner('loginError', 'Could not sign in:', [friendlyAuthError(e)]);
  } finally {
    btnBusy('loginBtn', false);
  }
};

/* =============================================================
   [INPUT] — REGISTER a new customer account
   ============================================================= */
window.doRegister = async function() {
  hideBanner('regError'); hideBanner('regSuccess');
  const name     = $('regName').value.trim();
  const email    = $('regEmail').value.trim();
  const password = $('regPass').value;

  // [CONTROL] validation
  const errs = [];
  if (!name)              errs.push('Full name is required.');
  if (!email)             errs.push('Email is required.');
  if (!password)          errs.push('Password is required.');
  else if (password.length < 6) errs.push('Password must be at least 6 characters.');
  if (errs.length) { showBanner('regError', 'Please fix:', errs); return; }

  $('regSpinner').classList.remove('hidden');
  try {
    const cred = await fbAuth.createUserWithEmailAndPassword(email, password);
    // [DB] write user profile to Firestore
    await COL_USERS().doc(cred.user.uid).set({ email, role: 'customer', displayName: name });
    await cred.user.updateProfile({ displayName: name });
    showBanner('regSuccess', 'Account created! You can now sign in.', []);
    $('regName').value = ''; $('regEmail').value = ''; $('regPass').value = '';
    setTimeout(() => { switchTab('login'); }, 1800);
  } catch (e) {
    showBanner('regError', 'Registration failed:', [friendlyAuthError(e)]);
  } finally {
    $('regSpinner').classList.add('hidden');
  }
};

/* =============================================================
   [QM] LOGOUT
   ============================================================= */
window.doLogout = async function() {
  await fbAuth.signOut();
  currentUser = null; currentRole = null;
  // Wipe rendered DOM so no data bleeds between sessions
  ['custBookingsWrap','custFeedbackList','summaryCards','mgmtBookingsWrap',
   'mgmtRefundsWrap','techWrap'].forEach(id => {
    const el = $(id); if (el) el.innerHTML = '';
  });
  showScreen('landing');
};

/* =============================================================
   [QM] ROUTING — called after confirmed login
   ============================================================= */
async function routeUser(userData) {
  const name = userData.displayName || currentUser.email;

  if (currentRole === 'customer') {
    $('custWho').textContent = name;
    prepCustomerForm(name);
    await loadCustomerBookings();
    showScreen('customer');
  } else {
    $('mgmtWho').textContent = name;
    await loadManagement();
    showScreen('management');
  }
}

/* =============================================================
   [QM] FIREBASE AUTH STATE OBSERVER
   Handles page refresh — re-attaches the session automatically.
   ============================================================= */
fbAuth.onAuthStateChanged(async (user) => {
  if (!user) {
    showScreen('landing');
    return;
  }
  setLoading('Restoring session…');
  try {
    const userDoc = await COL_USERS().doc(user.uid).get();
    if (!userDoc.exists) { await fbAuth.signOut(); showScreen('landing'); return; }
    currentUser = user;
    currentRole = userDoc.data().role;
    await maybeSeedDatabase(user.uid);
    await routeUser(userDoc.data());
  } catch (e) {
    console.error('Auth state error', e);
    showScreen('landing');
  }
});

/* =============================================================
   [INPUT] CUSTOMER — prepare booking form
   ============================================================= */
function prepCustomerForm(name) {
  $('bName').value = name || '';
  $('bDate').setAttribute('min', todayStr());
}

/* =============================================================
   [INPUT] + [CONTROL] + [DB] — SUBMIT BOOKING
   ============================================================= */
window.submitBooking = async function() {
  hideBanner('bookingError'); hideBanner('bookingSuccess');

  const payload = {
    customerName:   $('bName').value.trim(),
    address:        $('bAddress').value.trim(),
    phone:          $('bPhone').value.trim(),
    pestType:       $('bPest').value,
    preferredDate:  $('bDate').value,
    notes:          $('bNotes').value.trim(),
  };

  // [CONTROL] validation
  const errs = [];
  if (!payload.customerName) errs.push('Your name is required.');
  if (!payload.address)      errs.push('Service address is required.');
  if (!payload.phone)        errs.push('Phone is required.');
  else if (!/[0-9]/.test(payload.phone)) errs.push('Phone should include digits.');
  if (!payload.pestType)     errs.push('Select a pest type.');
  if (!payload.preferredDate) errs.push('Preferred date is required.');
  else if (payload.preferredDate < todayStr()) errs.push('Date cannot be in the past.');
  if (errs.length) { showBanner('bookingError', 'Please fix the following:', errs); return; }

  $('bookSpinner').classList.remove('hidden');
  try {
    // [DB] write booking to Firestore
    await COL_BOOKINGS().add({
      ...payload,
      customerUid:          currentUser.uid,
      status:               'Pending',
      assignedTechnicianId: null,
      technicianName:       null,
      feedbackRating:       null,
      feedbackDescription:  null,
      reportChemicals:      null,
      reportAreas:          null,
      reportRecommendations: null,
      refundStatus:         null,
      refundReason:         null,
      createdAt:            firebase.firestore.FieldValue.serverTimestamp(),
    });
    ['bAddress','bPhone','bDate','bNotes'].forEach(id => $(id).value = '');
    $('bPest').value = '';
    showBanner('bookingSuccess', 'Booking received! Your job is now Pending.', []);
    await loadCustomerBookings();
  } catch (e) {
    showBanner('bookingError', 'Could not save booking:', [e.message]);
  } finally {
    $('bookSpinner').classList.add('hidden');
  }
};

/* =============================================================
   [OUTPUT] CUSTOMER — load and render own bookings  [DB]
   ============================================================= */
window.loadCustomerBookings = async function() {
  const wrap = $('custBookingsWrap');
  wrap.innerHTML = '<div class="skeleton-table"></div>';

  try {
    // [QM] RBAC: query only this user's bookings
    const snap = await COL_BOOKINGS()
      .where('customerUid', '==', currentUser.uid)
      .orderBy('createdAt', 'desc')
      .get();

    const bookings = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderCustomerTable(bookings);
    renderFeedbackList(bookings);
  } catch (e) {
    wrap.innerHTML = '<div class="banner banner-error">Could not load bookings: ' + esc(e.message) + '</div>';
  }
};

function renderCustomerTable(bookings) {
  const wrap = $('custBookingsWrap');
  if (!bookings.length) {
    wrap.innerHTML = '<div class="table-wrap"><table><thead><tr><th>ID</th><th>Pest</th><th>Date</th><th>Status</th><th>Report</th><th>Actions</th></tr></thead><tbody><tr class="empty-row"><td colspan="6">No bookings yet — use the form to get started.</td></tr></tbody></table></div>';
    return;
  }
  const rows = bookings.map(b => {
    const shortId = b.id.slice(-6).toUpperCase();
    let report = '<span class="badge badge-none">Awaiting</span>';
    if (b.reportChemicals) report = '<button class="btn btn-ghost btn-sm" onclick="viewReport(\'' + b.id + '\')">View report</button>';

    const actions = [];
    if (b.status === 'Completed' && !b.feedbackRating) {
      actions.push('<button class="btn btn-primary btn-sm" onclick="openFeedback(\'' + b.id + '\')">★ Rate</button>');
    }
    if (!b.refundStatus) {
      actions.push('<button class="btn btn-ghost btn-sm" onclick="openRefund(\'' + b.id + '\')">Refund</button>');
    } else {
      actions.push(refundBadge(b.refundStatus));
    }
    return '<tr>' +
      '<td><code>' + shortId + '</code></td>' +
      '<td>' + esc(b.pestType) + '</td>' +
      '<td>' + esc(b.preferredDate) + '</td>' +
      '<td>' + statusBadge(b.status) + '</td>' +
      '<td>' + report + '</td>' +
      '<td><div class="cell-actions">' + (actions.join('') || '—') + '</div></td>' +
    '</tr>';
  }).join('');

  $('custBookingsWrap').innerHTML =
    '<div class="table-wrap"><table><thead><tr><th>ID</th><th>Pest</th><th>Date</th><th>Status</th><th>Report</th><th>Actions</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
}

function renderFeedbackList(bookings) {
  const withFb = bookings.filter(b => b.feedbackRating);
  const el = $('custFeedbackList');
  if (!withFb.length) {
    el.innerHTML = '<div class="card"><p class="meta-line" style="margin:0">No feedback yet. Rate a completed service above.</p></div>';
    return;
  }
  el.innerHTML = withFb.map(b =>
    '<div class="card" style="margin-bottom:.8rem">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:1rem;flex-wrap:wrap">' +
        '<strong>' + esc(b.pestType) + ' — ' + esc(b.preferredDate) + '</strong>' + readStars(b.feedbackRating) +
      '</div>' +
      '<p class="meta-line" style="margin:.4rem 0 0">' + esc(b.feedbackDescription || 'No comment.') + '</p>' +
    '</div>'
  ).join('');
}

/* =============================================================
   [OUTPUT] + [DB] MANAGEMENT — load all data
   ============================================================= */
window.loadManagement = async function() {
  // Reset to skeletons
  $('summaryCards').innerHTML = '<div class="stat skeleton-stat"></div>'.repeat(4);
  $('mgmtBookingsWrap').innerHTML = '<div class="skeleton-table"></div>';
  $('mgmtRefundsWrap').innerHTML  = '<div class="skeleton-table"></div>';
  $('techWrap').innerHTML         = '<div class="skeleton-table"></div>';

  try {
    const [bSnap, tSnap] = await Promise.all([
      COL_BOOKINGS().orderBy('createdAt', 'desc').get(),
      COL_TECHNICIANS().orderBy('name').get()
    ]);
    const bookings   = bSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const technicians = tSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    renderSummary(bookings, technicians);
    renderMgmtTable(bookings, technicians);
    renderRefunds(bookings);
    renderTechRoster(technicians);
  } catch (e) {
    $('mgmtBookingsWrap').innerHTML = '<div class="banner banner-error">Failed to load: ' + esc(e.message) + '</div>';
  }
};

function renderSummary(bookings, technicians) {
  const active   = bookings.filter(b => b.status === 'Pending' || b.status === 'En Route').length;
  const avail    = technicians.filter(t => t.isAvailable).length;
  const refunds  = bookings.filter(b => b.refundStatus === 'Requested').length;
  $('summaryCards').innerHTML =
    stat('info',   active,              'Active jobs (Pending + En Route)') +
    stat('',       avail,               'Available technicians') +
    stat('warn',   bookings.length,     'Total bookings') +
    stat('danger', refunds,             'Refunds awaiting review');
}
function stat(cls, num, lbl) {
  return '<div class="stat ' + cls + '"><div class="num">' + num + '</div><div class="lbl">' + lbl + '</div></div>';
}

function renderMgmtTable(bookings, technicians) {
  const anyFree = technicians.some(t => t.isAvailable);
  if (!bookings.length) {
    $('mgmtBookingsWrap').innerHTML = emptyTable(['ID','Customer','Pest','Date','Status','Technician','Actions'], 'No bookings in the system.');
    return;
  }
  const rows = bookings.map(b => {
    const shortId = b.id.slice(-6).toUpperCase();
    const actions = [];
    if (b.status === 'Pending') {
      actions.push('<button class="btn btn-primary btn-sm"' + (anyFree ? '' : ' disabled') + ' onclick="assignTechnician(\'' + b.id + '\')">' + (anyFree ? 'Assign tech' : 'No tech free') + '</button>');
    }
    if (b.status === 'En Route') {
      actions.push('<button class="btn btn-ghost btn-sm" onclick="completeJob(\'' + b.id + '\')">Mark done</button>');
    }
    if (b.status === 'Completed') {
      actions.push('<button class="btn btn-ghost btn-sm" onclick="openServiceReport(\'' + b.id + '\')">' + (b.reportChemicals ? 'Edit report' : 'Create report') + '</button>');
    }
    const tech = b.technicianName ? esc(b.technicianName) : '<span class="badge badge-none">Unassigned</span>';
    return '<tr>' +
      '<td><code>' + shortId + '</code></td>' +
      '<td>' + esc(b.customerName) + '</td>' +
      '<td>' + esc(b.pestType) + '</td>' +
      '<td>' + esc(b.preferredDate) + '</td>' +
      '<td>' + statusBadge(b.status) + '</td>' +
      '<td>' + tech + '</td>' +
      '<td><div class="cell-actions">' + (actions.join('') || '<span class="meta-line">—</span>') + '</div></td>' +
    '</tr>';
  }).join('');
  $('mgmtBookingsWrap').innerHTML = '<div class="table-wrap"><table><thead><tr><th>ID</th><th>Customer</th><th>Pest</th><th>Date</th><th>Status</th><th>Technician</th><th>Actions</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
}

function renderRefunds(bookings) {
  const reqs = bookings.filter(b => b.refundStatus);
  if (!reqs.length) {
    $('mgmtRefundsWrap').innerHTML = emptyTable(['Booking','Customer','Reason','Status','Decision'], 'No refund requests.');
    return;
  }
  const rows = reqs.map(b => {
    const shortId = b.id.slice(-6).toUpperCase();
    let decision = '<span class="meta-line">' + esc(b.refundStatus) + '</span>';
    if (b.refundStatus === 'Requested') {
      decision = '<div class="cell-actions">' +
        '<button class="btn btn-primary btn-sm" onclick="decideRefund(\'' + b.id + '\',true)">Approve</button>' +
        '<button class="btn btn-danger btn-sm" onclick="decideRefund(\'' + b.id + '\',false)">Deny</button>' +
      '</div>';
    }
    return '<tr><td><code>' + shortId + '</code></td><td>' + esc(b.customerName) + '</td><td>' + esc(b.refundReason) + '</td><td>' + refundBadge(b.refundStatus) + '</td><td>' + decision + '</td></tr>';
  }).join('');
  $('mgmtRefundsWrap').innerHTML = '<div class="table-wrap"><table><thead><tr><th>Booking</th><th>Customer</th><th>Reason</th><th>Status</th><th>Decision</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
}

function renderTechRoster(techs) {
  if (!techs.length) { $('techWrap').innerHTML = emptyTable(['Name','Status'], 'No technicians.'); return; }
  const rows = techs.map(t =>
    '<tr><td>' + esc(t.name) + '</td><td>' + (t.isAvailable ? '<span class="badge badge-completed">Available</span>' : '<span class="badge badge-enroute">On a job</span>') + '</td></tr>'
  ).join('');
  $('techWrap').innerHTML = '<div class="table-wrap"><table><thead><tr><th>Name</th><th>Availability</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
}

function emptyTable(cols, msg) {
  return '<div class="table-wrap"><table><thead><tr>' + cols.map(c => '<th>' + c + '</th>').join('') + '</tr></thead><tbody><tr class="empty-row"><td colspan="' + cols.length + '">' + msg + '</td></tr></tbody></table></div>';
}

/* =============================================================
   [DB] MANAGEMENT ACTIONS — assign / complete / report / refund
   All use Firestore transactions or batched writes for consistency.
   ============================================================= */
window.assignTechnician = async function(bookingId) {
  try {
    await fbDb.runTransaction(async tx => {
      // Find a free technician
      const techSnap = await COL_TECHNICIANS().where('isAvailable','==',true).limit(1).get();
      if (techSnap.empty) throw new Error('No technician is currently available.');
      const techDoc  = techSnap.docs[0];
      const techData = techDoc.data();

      tx.update(COL_BOOKINGS().doc(bookingId), {
        status:               'En Route',
        assignedTechnicianId: techDoc.id,
        technicianName:       techData.name,
      });
      tx.update(COL_TECHNICIANS().doc(techDoc.id), { isAvailable: false });
    });
    await loadManagement();
  } catch (e) {
    openInfoModal('Could not assign', e.message);
  }
};

window.completeJob = async function(bookingId) {
  try {
    const bookSnap = await COL_BOOKINGS().doc(bookingId).get();
    const book     = bookSnap.data();
    const batch    = fbDb.batch();
    batch.update(COL_BOOKINGS().doc(bookingId), { status: 'Completed' });
    if (book.assignedTechnicianId) {
      batch.update(COL_TECHNICIANS().doc(book.assignedTechnicianId), { isAvailable: true });
    }
    await batch.commit();
    await loadManagement();
  } catch (e) {
    openInfoModal('Could not complete job', e.message);
  }
};

window.decideRefund = async function(bookingId, approve) {
  try {
    await COL_BOOKINGS().doc(bookingId).update({ refundStatus: approve ? 'Approved' : 'Denied' });
    await loadManagement();
  } catch (e) {
    openInfoModal('Error', e.message);
  }
};

/* =============================================================
   [DB] + [INPUT] + [CONTROL] SERVICE REPORT (digital)
   ============================================================= */
let reportTargetId = null;

window.openServiceReport = async function(bookingId) {
  reportTargetId = bookingId;
  const snap = await COL_BOOKINGS().doc(bookingId).get();
  const b    = snap.data() || {};
  openModal(
    '<h2>Service report</h2>' +
    '<p class="sub">' + esc(b.customerName) + ' · ' + esc(b.pestType) + ' · ' + esc(b.preferredDate) + '</p>' +
    '<div class="field"><label for="srChem">Chemicals used <span class="req">*</span></label><textarea id="srChem" placeholder="e.g. Fipronil 0.05%, boric acid bait">' + esc(b.reportChemicals || '') + '</textarea></div>' +
    '<div class="field"><label for="srAreas">Areas treated <span class="req">*</span></label><textarea id="srAreas" placeholder="e.g. Kitchen, garage, perimeter">' + esc(b.reportAreas || '') + '</textarea></div>' +
    '<div class="field"><label for="srRec">Recommendations</label><textarea id="srRec" placeholder="Follow-up advice for the customer">' + esc(b.reportRecommendations || '') + '</textarea></div>' +
    '<div id="srError" class="banner banner-error hidden"></div>' +
    '<div class="modal-actions">' +
      '<button class="btn btn-ghost" onclick="closeModal()">Cancel</button>' +
      '<button class="btn btn-primary" onclick="saveReport()">Save report</button>' +
    '</div>'
  );
};

window.saveReport = async function() {
  const chemicals      = $('srChem').value.trim();
  const areas          = $('srAreas').value.trim();
  const recommendations = $('srRec').value.trim();
  const errs = [];
  if (!chemicals) errs.push('List the chemicals used.');
  if (!areas)     errs.push('List the areas treated.');
  if (errs.length) { showBanner('srError', 'Please complete the report:', errs); return; }
  try {
    await COL_BOOKINGS().doc(reportTargetId).update({ reportChemicals: chemicals, reportAreas: areas, reportRecommendations: recommendations });
    closeModal();
    await loadManagement();
  } catch (e) {
    showBanner('srError', 'Error:', [e.message]);
  }
};

window.viewReport = async function(bookingId) {
  const snap = await COL_BOOKINGS().doc(bookingId).get();
  const b    = snap.data() || {};
  if (!b.reportChemicals) return;
  openModal(
    '<h2>Service report</h2>' +
    '<p class="sub">' + esc(b.pestType) + ' · ' + esc(b.preferredDate) + '</p>' +
    '<h3>Chemicals used</h3><p class="meta-line">' + esc(b.reportChemicals) + '</p>' +
    '<h3 style="margin-top:.8rem">Areas treated</h3><p class="meta-line">' + esc(b.reportAreas) + '</p>' +
    '<h3 style="margin-top:.8rem">Recommendations</h3><p class="meta-line">' + esc(b.reportRecommendations || 'None.') + '</p>' +
    '<div class="modal-actions"><button class="btn btn-primary" onclick="closeModal()">Close</button></div>'
  );
};

/* =============================================================
   [INPUT] + [DB] FEEDBACK (1–5 stars)
   ============================================================= */
let feedbackDraft = { id: null, rating: 0 };

window.openFeedback = function(bookingId) {
  feedbackDraft = { id: bookingId, rating: 0 };
  openModal(
    '<h2>Rate your service</h2>' +
    '<p class="sub">How satisfied were you with this visit?</p>' +
    '<div class="stars" id="starPicker">' + starBtns(0) + '</div>' +
    '<div class="field" style="margin-top:1rem"><label for="fbDesc">Comments <span class="opt">(optional)</span></label><textarea id="fbDesc" placeholder="Tell us about the service…"></textarea></div>' +
    '<div id="fbError" class="banner banner-error hidden"></div>' +
    '<div class="modal-actions">' +
      '<button class="btn btn-ghost" onclick="closeModal()">Cancel</button>' +
      '<button class="btn btn-primary" onclick="submitFeedback()">Submit rating</button>' +
    '</div>'
  );
};

window.setStar = function(n) {
  feedbackDraft.rating = n;
  $('starPicker').innerHTML = starBtns(n);
};

function starBtns(active) {
  let h = '';
  for (let i = 1; i <= 5; i++) h += '<button type="button" class="star' + (i <= active ? ' on' : '') + '" onclick="setStar(' + i + ')">&#9733;</button>';
  return h;
}
function readStars(n) {
  let h = '<span class="stars read">';
  for (let i = 1; i <= 5; i++) h += '<span class="star' + (i <= n ? ' on' : '') + '">&#9733;</span>';
  return h + '</span>';
}

window.submitFeedback = async function() {
  if (!feedbackDraft.rating) { showBanner('fbError', 'Choose a star rating (1–5).', []); return; }
  try {
    await COL_BOOKINGS().doc(feedbackDraft.id).update({
      feedbackRating:      feedbackDraft.rating,
      feedbackDescription: $('fbDesc').value.trim(),
    });
    closeModal();
    await loadCustomerBookings();
  } catch (e) {
    showBanner('fbError', 'Error:', [e.message]);
  }
};

/* =============================================================
   [INPUT] + [DB] REFUND REQUEST (customer)
   ============================================================= */
let refundTargetId = null;

window.openRefund = function(bookingId) {
  refundTargetId = bookingId;
  openModal(
    '<h2>Request a refund</h2>' +
    '<p class="sub">Describe why you\'re requesting a refund.</p>' +
    '<div class="field"><label for="rfReason">Reason <span class="req">*</span></label><textarea id="rfReason" placeholder="What went wrong?"></textarea></div>' +
    '<div id="rfError" class="banner banner-error hidden"></div>' +
    '<div class="modal-actions">' +
      '<button class="btn btn-ghost" onclick="closeModal()">Cancel</button>' +
      '<button class="btn btn-primary" onclick="submitRefund()">Submit request</button>' +
    '</div>'
  );
};

window.submitRefund = async function() {
  const reason = $('rfReason').value.trim();
  if (!reason) { showBanner('rfError', 'A reason is required.', []); return; }
  try {
    await COL_BOOKINGS().doc(refundTargetId).update({ refundStatus: 'Requested', refundReason: reason });
    closeModal();
    await loadCustomerBookings();
  } catch (e) {
    showBanner('rfError', 'Error:', [e.message]);
  }
};

/* =============================================================
   [OUTPUT] BADGE + STATUS helpers
   ============================================================= */
function statusBadge(s) {
  const m = { 'Pending':'badge-pending','En Route':'badge-enroute','Completed':'badge-completed' };
  return '<span class="badge ' + (m[s] || 'badge-none') + '">' + esc(s) + '</span>';
}
function refundBadge(s) {
  const m = { 'Requested':'badge-requested','Approved':'badge-approved','Denied':'badge-denied' };
  return '<span class="badge ' + (m[s] || 'badge-none') + '">' + esc(s) + '</span>';
}

/* =============================================================
   [QM] FIREBASE AUTH ERROR → friendly message
   ============================================================= */
function friendlyAuthError(e) {
  const map = {
    'auth/user-not-found':      'No account found with that email.',
    'auth/wrong-password':      'Incorrect password. Please try again.',
    'auth/invalid-credential':  'Incorrect email or password. Please try again.',
    'auth/email-already-in-use':'An account with that email already exists.',
    'auth/weak-password':       'Password must be at least 6 characters.',
    'auth/invalid-email':       'That email address is not valid.',
    'auth/too-many-requests':   'Too many attempts. Try again in a few minutes.',
    'auth/network-request-failed':'Network error. Check your connection.',
  };
  return map[e.code] || e.message || 'An unexpected error occurred.';
}

function openInfoModal(title, msg) {
  openModal('<h2>' + esc(title) + '</h2><p class="sub">' + esc(msg) + '</p>' +
    '<div class="modal-actions"><button class="btn btn-primary" onclick="closeModal()">OK</button></div>');
}

/* =============================================================
   [QM] KEYBOARD + ACCESSIBILITY
   ============================================================= */
document.getElementById('loginPass').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
document.getElementById('loginEmail').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// Default role selection
selectRole('customer');
