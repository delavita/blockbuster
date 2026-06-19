'use strict';
/* =============================================================
   BUGBUSTER PRO — frontend logic (talks to the REST API)
   Sections map to SAD concepts for the report:
     Input Design, Output Design, Control Mechanism,
     Database/ERD (server-side), Quality Management, RBAC.
   ============================================================= */

// Session held in memory only (cleared on logout / reload).
let authToken = null;
let session = { role: null, name: null };
let selectedRole = null;

/* ---------- API client ---------- */
async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (authToken) headers['x-auth-token'] = authToken;
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  if (res.status === 401 && authToken) { hardLogout(); throw new Error('Session expired — please sign in again.'); }
  if (!res.ok) { const e = new Error('request failed'); e.status = res.status; e.data = data || {}; throw e; }
  return data;
}

/* ---------- DOM helpers ---------- */
const $ = id => document.getElementById(id);
function hide(id) { $(id).classList.add('hidden'); }
function showBanner(id, title, items) {
  const el = $(id);
  let html = '<strong>' + title + '</strong>';
  if (items && items.length) html += '<ul>' + items.map(i => '<li>' + esc(i) + '</li>').join('') + '</ul>';
  el.innerHTML = html; el.classList.remove('hidden');
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function todayStr() { const d = new Date(); const p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }

function statusBadge(s) { const m = { 'Pending': 'badge-pending', 'En Route': 'badge-enroute', 'Completed': 'badge-completed' }; return '<span class="badge ' + (m[s] || 'badge-none') + '">' + esc(s) + '</span>'; }
function refundBadge(s) { const m = { 'Requested': 'badge-requested', 'Approved': 'badge-approved', 'Denied': 'badge-denied' }; return '<span class="badge ' + (m[s] || 'badge-none') + '">' + esc(s) + '</span>'; }

/* ---------- Modal ---------- */
function openModal(html) { $('modalBox').innerHTML = html; $('modalOverlay').classList.add('open'); }
function closeModal() { $('modalOverlay').classList.remove('open'); $('modalBox').innerHTML = ''; }

/* =============================================================
   ROUTING + RBAC
   ============================================================= */
function showScreen(which) {
  ['landing', 'customer', 'management'].forEach(s => $('screen-' + s).classList.add('hidden'));
  $('screen-' + which).classList.remove('hidden');
  window.scrollTo(0, 0);
}
function selectRole(role) {
  selectedRole = role;
  $('roleCustomerBtn').classList.toggle('active', role === 'customer');
  $('roleManagementBtn').classList.toggle('active', role === 'management');
  hide('loginError');
}

async function login() {
  hide('loginError');
  const email = $('loginName').value.trim(); // Firebase menggunakan Email
  const password = $('loginPass').value;

  // Pastikan user sudah memilih role
  if (!selectedRole) {
    showBanner('loginError', 'Pilih peran terlebih dahulu:', ['Silakan klik Customer atau Management.']);
    return;
  }

  try {
    // 1. Memanggil Firebase Authentication
    const userCredential = await window.signInWithEmailAndPassword(window.firebaseAuth, email, password);
    const user = userCredential.user;

    // 2. Buat sesi lokal sementara
    session = { role: selectedRole, name: user.email.split('@')[0] };

    // 3. Arahkan user ke halaman dashboard
    if (selectedRole === 'customer') {
      $('custWho').textContent = session.name;
      prepCustomerForm();
      try { await renderCustomer(); } catch(e) { console.log('Backend mungkin mati: ', e.message); }
      showScreen('customer');
    } else {
      $('mgmtWho').textContent = session.name;
      try { await renderManagement(); } catch(e) { console.log('Backend mungkin mati: ', e.message); }
      showScreen('management');
    }
  } catch (error) {
    showBanner('loginError', 'Gagal Sign In:', [error.message]);
  }
}

async function logout() {
  try { await api('/api/logout', { method: 'POST' }); } catch { /* ignore */ }
  hardLogout();
}
function hardLogout() {
  // RBAC: clear session + wipe rendered data for BOTH dashboards.
  authToken = null; session = { role: null, name: null }; selectedRole = null;
  ['custBookingsBody', 'custFeedbackList', 'mgmtBookingsBody', 'mgmtRefundsBody', 'summaryCards', 'techBody'].forEach(id => $(id).innerHTML = '');
  $('custWho').textContent = '—'; $('mgmtWho').textContent = '—';
  $('loginName').value = ''; $('loginPass').value = '';
  $('roleCustomerBtn').classList.remove('active'); $('roleManagementBtn').classList.remove('active');
  hide('loginError'); hide('bookingError'); hide('bookingSuccess');
  showScreen('landing');
}

/* =============================================================
   CUSTOMER — INPUT DESIGN + CONTROL MECHANISM
   ============================================================= */
function prepCustomerForm() {
  $('bName').value = session.name;
  $('bDate').setAttribute('min', todayStr());
}

async function submitBooking() {
  hide('bookingError'); hide('bookingSuccess');
  const payload = {
    customerName: $('bName').value.trim(),
    address: $('bAddress').value.trim(),
    phone: $('bPhone').value.trim(),
    pestType: $('bPest').value,
    preferredDate: $('bDate').value,
    notes: $('bNotes').value.trim()
  };

  // Client-side validation (mirrors the server's Control Mechanism).
  const errors = [];
  if (!payload.customerName) errors.push('Customer name is required.');
  if (!payload.address) errors.push('Address is required.');
  if (!payload.phone) errors.push('Phone is required.');
  else if (!/[0-9]/.test(payload.phone)) errors.push('Phone should contain digits.');
  if (!payload.pestType) errors.push('Select a pest type.');
  if (!payload.preferredDate) errors.push('Preferred date is required.');
  else if (payload.preferredDate < todayStr()) errors.push('Preferred date cannot be earlier than today.');
  if (errors.length) { showBanner('bookingError', 'Please fix the following:', errors); return; }

  try {
    await api('/api/bookings', { method: 'POST', body: payload });
    ['bAddress', 'bPhone', 'bDate', 'bNotes'].forEach(id => $(id).value = '');
    $('bPest').value = '';
    showBanner('bookingSuccess', 'Booking received! It is now Pending and visible below.', []);
    await renderCustomer();
  } catch (e) {
    showBanner('bookingError', 'Please fix the following:', (e.data && e.data.errors) || ['Could not save the booking.']);
  }
}

/* =============================================================
   CUSTOMER — OUTPUT DESIGN
   ============================================================= */
async function renderCustomer() {
  const mine = await api('/api/bookings');
  const body = $('custBookingsBody');

  if (!mine.length) {
    body.innerHTML = '<tr class="empty-row"><td colspan="6">No bookings yet. Use the form to book your first service.</td></tr>';
  } else {
    body.innerHTML = mine.map(b => {
      let report = '<span class="badge badge-none">Pending job</span>';
      if (b.serviceReport) report = '<button class="btn btn-ghost btn-sm" onclick="viewServiceReport(\'' + b.id + '\')">View report</button>';
      const actions = [];
      if (b.status === 'Completed' && !b.feedback) actions.push('<button class="btn btn-primary btn-sm" onclick="openFeedback(\'' + b.id + '\')">Rate service</button>');
      if (!b.refund) actions.push('<button class="btn btn-ghost btn-sm" onclick="openRefund(\'' + b.id + '\')">Request refund</button>');
      else actions.push('<span class="badge ' + ({ Requested: 'badge-requested', Approved: 'badge-approved', Denied: 'badge-denied' }[b.refund.status] || 'badge-none') + '">Refund: ' + esc(b.refund.status) + '</span>');
      return '<tr><td>' + b.id + '</td><td>' + esc(b.pestType) + '</td><td>' + esc(b.preferredDate) + '</td><td>' + statusBadge(b.status) + '</td><td>' + report + '</td><td><div class="cell-actions">' + actions.join('') + '</div></td></tr>';
    }).join('');
  }

  const withFb = mine.filter(b => b.feedback);
  const fbList = $('custFeedbackList');
  if (!withFb.length) {
    fbList.innerHTML = '<div class="card"><p class="meta-line" style="margin:0;">No feedback yet. Rate a completed service to see it here.</p></div>';
  } else {
    fbList.innerHTML = withFb.map(b =>
      '<div class="card" style="margin-bottom:0.8rem;"><div style="display:flex;justify-content:space-between;align-items:center;gap:1rem;flex-wrap:wrap;"><strong>' + b.id + ' · ' + esc(b.pestType) + '</strong>' + readStars(b.feedback.rating) + '</div><p class="meta-line" style="margin:0.4rem 0 0;">' + esc(b.feedback.description || 'No comment left.') + '</p></div>'
    ).join('');
  }
}

/* =============================================================
   CUSTOMER — FEEDBACK (1–5 stars)
   ============================================================= */
let feedbackDraft = { id: null, rating: 0 };
function openFeedback(id) {
  feedbackDraft = { id, rating: 0 };
  openModal('<h2>Rate your service</h2><p class="sub">Booking ' + id + ' — how satisfied were you?</p>' +
    '<div class="stars" id="starPicker">' + starButtons(0) + '</div>' +
    '<div class="field" style="margin-top:1rem;"><label for="fbDesc">Comments</label><textarea id="fbDesc" placeholder="Tell us about the service…"></textarea></div>' +
    '<div id="fbError" class="banner banner-error hidden"></div>' +
    '<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="submitFeedback()">Submit rating</button></div>');
}
function starButtons(active) { let h = ''; for (let i = 1; i <= 5; i++) h += '<button type="button" class="star ' + (i <= active ? 'on' : '') + '" onclick="setStar(' + i + ')">&#9733;</button>'; return h; }
function setStar(n) { feedbackDraft.rating = n; $('starPicker').innerHTML = starButtons(n); }
function readStars(n) { let h = '<span class="stars read">'; for (let i = 1; i <= 5; i++) h += '<span class="star ' + (i <= n ? 'on' : '') + '">&#9733;</span>'; return h + '</span>'; }
async function submitFeedback() {
  if (!feedbackDraft.rating) { showBanner('fbError', 'Please choose a star rating (1–5).', []); return; }
  try {
    await api('/api/bookings/' + feedbackDraft.id + '/feedback', { method: 'POST', body: { rating: feedbackDraft.rating, description: $('fbDesc').value.trim() } });
    closeModal(); await renderCustomer();
  } catch (e) { showBanner('fbError', 'Could not save feedback:', (e.data && e.data.errors) || ['Try again.']); }
}

/* =============================================================
   REFUNDS — customer request
   ============================================================= */
let refundDraftId = null;
function openRefund(id) {
  refundDraftId = id;
  openModal('<h2>Request a refund</h2><p class="sub">Booking ' + id + ' — tell us why you\'re requesting a refund.</p>' +
    '<div class="field"><label for="rfReason">Reason <span class="req">*</span></label><textarea id="rfReason" placeholder="Describe the issue…"></textarea></div>' +
    '<div id="rfError" class="banner banner-error hidden"></div>' +
    '<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="submitRefund()">Submit request</button></div>');
}
async function submitRefund() {
  const reason = $('rfReason').value.trim();
  if (!reason) { showBanner('rfError', 'A reason is required to request a refund.', []); return; }
  try { await api('/api/bookings/' + refundDraftId + '/refund', { method: 'POST', body: { reason } }); closeModal(); await renderCustomer(); }
  catch (e) { showBanner('rfError', 'Could not submit refund:', (e.data && e.data.errors) || ['Try again.']); }
}

/* =============================================================
   MANAGEMENT — INTERNAL OUTPUT + MASTER TABLE + ACTIONS
   ============================================================= */
async function renderManagement() {
  const [summary, bookings, techs] = await Promise.all([
    api('/api/summary'), api('/api/bookings'), api('/api/technicians')
  ]);

  $('summaryCards').innerHTML =
    '<div class="stat info"><div class="num">' + summary.activeJobs + '</div><div class="lbl">Active jobs (Pending + En Route)</div></div>' +
    '<div class="stat"><div class="num">' + summary.availableTechnicians + '</div><div class="lbl">Available technicians</div></div>' +
    '<div class="stat warn"><div class="num">' + summary.totalBookings + '</div><div class="lbl">Total bookings</div></div>' +
    '<div class="stat danger"><div class="num">' + summary.pendingRefunds + '</div><div class="lbl">Refunds awaiting review</div></div>';

  const body = $('mgmtBookingsBody');
  if (!bookings.length) {
    body.innerHTML = '<tr class="empty-row"><td colspan="7">No bookings in the system.</td></tr>';
  } else {
    const anyFree = techs.some(t => t.isAvailable);
    body.innerHTML = bookings.map(b => {
      const actions = [];
      if (b.status === 'Pending') actions.push('<button class="btn btn-primary btn-sm" onclick="assignTechnician(\'' + b.id + '\')"' + (anyFree ? '' : ' disabled') + '>' + (anyFree ? 'Assign technician' : 'No tech free') + '</button>');
      if (b.status === 'En Route') actions.push('<button class="btn btn-ghost btn-sm" onclick="completeJob(\'' + b.id + '\')">Mark completed</button>');
      if (b.status === 'Completed') actions.push('<button class="btn btn-ghost btn-sm" onclick="openServiceReport(\'' + b.id + '\')">' + (b.serviceReport ? 'Edit report' : 'Create report') + '</button>');
      const tech = b.technicianName ? esc(b.technicianName) : '<span class="badge badge-none">Unassigned</span>';
      return '<tr><td>' + b.id + '</td><td>' + esc(b.customerName) + '</td><td>' + esc(b.pestType) + '</td><td>' + esc(b.preferredDate) + '</td><td>' + statusBadge(b.status) + '</td><td>' + tech + '</td><td><div class="cell-actions">' + (actions.join('') || '<span class="meta-line">—</span>') + '</div></td></tr>';
    }).join('');
  }

  const reqs = bookings.filter(b => b.refund);
  const rbody = $('mgmtRefundsBody');
  if (!reqs.length) {
    rbody.innerHTML = '<tr class="empty-row"><td colspan="5">No refund requests.</td></tr>';
  } else {
    rbody.innerHTML = reqs.map(b => {
      let decision = '<span class="meta-line">' + esc(b.refund.status) + '</span>';
      if (b.refund.status === 'Requested') {
        decision = '<div class="cell-actions"><button class="btn btn-primary btn-sm" onclick="decideRefund(\'' + b.id + '\', true)">Approve</button><button class="btn btn-danger btn-sm" onclick="decideRefund(\'' + b.id + '\', false)">Deny</button></div>';
      }
      return '<tr><td>' + b.id + '</td><td>' + esc(b.customerName) + '</td><td>' + esc(b.refund.reason) + '</td><td>' + refundBadge(b.refund.status) + '</td><td>' + decision + '</td></tr>';
    }).join('');
  }

  $('techBody').innerHTML = techs.map(t =>
    '<tr><td>' + t.id + '</td><td>' + esc(t.name) + '</td><td>' + (t.isAvailable ? '<span class="badge badge-completed">Available</span>' : '<span class="badge badge-enroute">On a job</span>') + '</td></tr>'
  ).join('');
}

async function assignTechnician(id) {
  try { await api('/api/bookings/' + id + '/assign', { method: 'POST' }); await renderManagement(); }
  catch (e) { openInfo('Could not assign', (e.data && e.data.error) || 'No technician available.'); }
}
async function completeJob(id) { try { await api('/api/bookings/' + id + '/complete', { method: 'POST' }); await renderManagement(); } catch (e) { openInfo('Could not complete', 'Try again.'); } }
async function decideRefund(id, approve) { try { await api('/api/bookings/' + id + '/refund-decision', { method: 'POST', body: { approve } }); await renderManagement(); } catch (e) { openInfo('Could not update refund', 'Try again.'); } }

function openInfo(title, msg) {
  openModal('<h2>' + esc(title) + '</h2><p class="sub">' + esc(msg) + '</p><div class="modal-actions"><button class="btn btn-primary" onclick="closeModal()">OK</button></div>');
}

/* =============================================================
   MANAGEMENT — DIGITAL SERVICE REPORT
   ============================================================= */
let reportDraftId = null;
async function openServiceReport(id) {
  reportDraftId = id;
  const b = await api('/api/bookings').then(list => list.find(x => x.id === id));
  const r = (b && b.serviceReport) || { chemicals: '', areas: '', recommendations: '' };
  openModal('<h2>Service report</h2><p class="sub">Booking ' + id + ' — ' + esc(b.customerName) + ' · ' + esc(b.pestType) + '</p>' +
    '<div class="field"><label for="srChem">Chemicals used <span class="req">*</span></label><textarea id="srChem" placeholder="e.g. Fipronil 0.05%, bait stations">' + esc(r.chemicals) + '</textarea></div>' +
    '<div class="field"><label for="srAreas">Areas treated <span class="req">*</span></label><textarea id="srAreas" placeholder="e.g. Kitchen, garage, perimeter">' + esc(r.areas) + '</textarea></div>' +
    '<div class="field"><label for="srRec">Recommendations</label><textarea id="srRec" placeholder="Follow-up advice for the customer">' + esc(r.recommendations) + '</textarea></div>' +
    '<div id="srError" class="banner banner-error hidden"></div>' +
    '<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveServiceReport()">Save report</button></div>');
}
async function saveServiceReport() {
  const body = { chemicals: $('srChem').value.trim(), areas: $('srAreas').value.trim(), recommendations: $('srRec').value.trim() };
  const errors = [];
  if (!body.chemicals) errors.push('List the chemicals used.');
  if (!body.areas) errors.push('List the areas treated.');
  if (errors.length) { showBanner('srError', 'Please complete the report:', errors); return; }
  try { await api('/api/bookings/' + reportDraftId + '/report', { method: 'POST', body }); closeModal(); await renderManagement(); }
  catch (e) { showBanner('srError', 'Could not save report:', (e.data && e.data.errors) || ['Try again.']); }
}
async function viewServiceReport(id) {
  const b = await api('/api/bookings').then(list => list.find(x => x.id === id));
  if (!b || !b.serviceReport) return;
  const r = b.serviceReport;
  openModal('<h2>Service report</h2><p class="sub">Booking ' + id + ' · ' + esc(b.pestType) + '</p>' +
    '<h3>Chemicals used</h3><p class="meta-line">' + esc(r.chemicals) + '</p>' +
    '<h3 style="margin-top:0.8rem;">Areas treated</h3><p class="meta-line">' + esc(r.areas) + '</p>' +
    '<h3 style="margin-top:0.8rem;">Recommendations</h3><p class="meta-line">' + esc(r.recommendations || 'None provided.') + '</p>' +
    '<div class="modal-actions"><button class="btn btn-primary" onclick="closeModal()">Close</button></div>');
}

/* =============================================================
   WIRING — expose handlers + attach listeners
   ============================================================= */
window.closeModal = closeModal;
window.setStar = setStar; window.submitFeedback = submitFeedback; window.openFeedback = openFeedback;
window.openRefund = openRefund; window.submitRefund = submitRefund;
window.assignTechnician = assignTechnician; window.completeJob = completeJob; window.decideRefund = decideRefund;
window.openServiceReport = openServiceReport; window.saveServiceReport = saveServiceReport; window.viewServiceReport = viewServiceReport;

document.getElementById('roleCustomerBtn').addEventListener('click', () => selectRole('customer'));
document.getElementById('roleManagementBtn').addEventListener('click', () => selectRole('management'));
document.getElementById('loginBtn').addEventListener('click', login);
document.getElementById('custLogout').addEventListener('click', logout);
document.getElementById('mgmtLogout').addEventListener('click', logout);
document.getElementById('bookBtn').addEventListener('click', submitBooking);
document.getElementById('loginName').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
document.getElementById('loginPass').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
document.getElementById('modalOverlay').addEventListener('click', e => { if (e.target === document.getElementById('modalOverlay')) closeModal(); });

showScreen('landing');
