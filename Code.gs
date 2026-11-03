/**
 * Economic Inclusion Program (EIP) portal — Apps Script backend (authenticated API).
 *
 * Sign-in: emailed 6-digit code, tied to the person's email address. Only
 * people CRD has added (Users tab) or approved from an access request can
 * receive a code. Everything the portal shows is fetched through this API
 * and checked against the person's ROLE (pages, comments, refresh, PDF,
 * feedback). The Vercel site is just a data-free shell.
 *
 * Root admin: ROOT_ADMIN below. Only the root admin can grant or revoke
 * the Admin role. Admins get emailed about comments, replies, access
 * requests and feedback.
 *
 * SETUP — see PORTAL_SETUP.md. In short:
 *  1. Set COMMENTS_SHEET_ID, ASSETS_FOLDER_ID, SITE_URL below.
 *  2. Run setupPortal() once from the editor (creates tabs, migrates the
 *     old Whitelist as Team members, creates default roles, authorises mail).
 *  3. Deploy → Manage deployments → New version.
 */

// ---- CONFIG ----------------------------------------------------------
const ROOT_ADMIN = 'crd@thenudge.org';
const COMMENTS_SHEET_ID = 'PASTE_YOUR_SHEET_ID_HERE';
// Private Drive folder holding content.json and photo JSON files (see guide).
const ASSETS_FOLDER_ID = 'PASTE_ASSETS_FOLDER_ID_HERE';
// The Vercel site URL — used in sign-in / invite emails.
const SITE_URL = '';
const PORTAL_NAME = 'The/Nudge Economic Inclusion Program (EIP) Portal';

const OTP_TTL_SEC = 15 * 60;
const OTP_MAX_TRIES = 5;
const OTP_MAX_REQUESTS_PER_HOUR = 5;
const SESSION_DAYS = 14;

// ---- Source sheets for live data (unchanged) ---------------------------
const TRACKER_SHEET_ID = '1oGc46797I2B_pjkWslTm-43GV37raJxXOz6F5vJ_9zM';
const PROGRESS_TAB = 'Govt Support Need - Ongoing Projects';
const DEALS_TAB = 'Govt. Deals Status - New';
const PARTNERSHIP_TAB = 'Partnership Grid';
const CONVENINGS_TAB = 'Ecosystem / Convenings';

const RESEARCH_SHEET_ID = '1oMW6nOILH6soBbR3rdDNUbgIulrBLqiVmi_MTHghMzY';
const IN_CONCEPT_TAB = 'In-concept studies';
const IN_EXECUTION_TAB = 'In-execution studies';
const LIVELIHOOD_TAB = 'Livelihood Research';

// Programme-level quarterly trend (first tab, first 10 rows: header + 9 stages).
const TREND_SHEET_ID = '10NLy-XkvEC2ZM0gT0HKhwtw8R804ywRTGnB05tTvGYU';
const DEALS_WEBSITE_COL = 'Website';
const DEAL_STAGE_COLS = ['Proposal Submitted / Project Review', 'In-Principal Approval', 'Finance Approval', 'MoU Signed'];

// ---- Portal tabs ---------------------------------------------------------
const COMMENTS_TAB_NAME = 'Comments';
const HEADER = ['ID', 'ParentID', 'Section', 'Name', 'Comment', 'Timestamp', 'Resolved', 'Email'];
const WHITELIST_TAB_NAME = 'Whitelist'; // legacy, migrated once
const USERS_TAB = 'Users';
const USERS_HEADER = ['Email', 'Name', 'Role', 'Status', 'AddedBy', 'AddedDate', 'LastLogin'];
const ROLES_TAB = 'Roles';
const ROLES_HEADER = ['RoleId', 'Label', 'PermissionsJSON', 'System'];
const SESSIONS_TAB = 'Sessions';
const SESSIONS_HEADER = ['TokenHash', 'Email', 'Created', 'Expires', 'Revoked'];
const ACCESS_REQUESTS_TAB_NAME = 'AccessRequests';
const REQUEST_HEADER = ['Email', 'Name', 'Reason', 'RequestedDate', 'Status'];

// Every page id the portal has (used by the role editor).
const ALL_PAGES = ['dashboard', 'progress', 'deals', 'product', 'research', 'ecosystem', 'field'];
const PAGE_LABELS = {
  dashboard: 'Overview', progress: 'Project Progress',
  deals: 'New Govt. Partnerships', product: 'Product Update',
  research: 'Research & Evaluation', ecosystem: 'Ecosystem Partnerships', field: 'From the Field',
};
const SECTION_LABELS = PAGE_LABELS;

const DEFAULT_ROLES = [
  { id: 'admin', label: 'Admin', system: true,
    perms: { pages: ALL_PAGES, comments: 'post', refresh: true, pdf: true, feedback: true } },
  { id: 'team', label: 'Team member', system: false,
    perms: { pages: ALL_PAGES, comments: 'post', refresh: true, pdf: true, feedback: true } },
  { id: 'donor', label: 'Donor / stakeholder (view only)', system: false,
    perms: { pages: ALL_PAGES, comments: 'view', refresh: false, pdf: true, feedback: true } },
];

// ---- Entry points -------------------------------------------------------
function doGet() {
  return ContentService.createTextOutput('EIP portal API. Use POST.')
    .setMimeType(ContentService.MimeType.TEXT);
}

/**
 * Body: { fn, token, args:[...] }. Public functions need no token; all
 * others need a valid session. Errors return { success:false, error }.
 */
function doPost(e) {
  let result;
  try {
    const body = JSON.parse(e.postData.contents);
    result = _dispatch_(body.fn, body.token, body.args || []);
  } catch (err) {
    result = { success: false, error: 'Server error: ' + err };
  }
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function _publicFns_() {
  return { requestCode: requestCode, verifyCode: verifyCode, requestAccess: requestAccess };
}

// fn -> { f: handler(user, ...args), page?: pageId, admin?: true }
function _authedFns_() {
  return {
    getMe: { f: getMe },
    updateProfile: { f: updateProfile },
    signOut: { f: signOut },
    signOutEverywhere: { f: signOutEverywhere },
    getContent: { f: getContent },
    getPhotos: { f: getPhotos },
    getComments: { f: getComments },
    addComment: { f: addComment },
    resolveComment: { f: resolveComment },
    submitFeedback: { f: submitFeedback },
    getProgressData: { f: function (u) { return getProgressData(); }, page: 'progress' },
    getDealsData: { f: function (u) { return getDealsData(); }, page: 'deals' },
    getResearchData: { f: function (u) { return getResearchData(); }, page: 'research' },
    getEcosystemData: { f: function (u) { return getEcosystemData(); }, page: 'ecosystem' },
    getMapData: { f: getMapData, page: 'dashboard' },
    getTrendData: { f: function (u) { return getTrendData(); }, page: 'dashboard' },
    adminListUsers: { f: adminListUsers, admin: true },
    adminSaveUser: { f: adminSaveUser, admin: true },
    adminSetUserStatus: { f: adminSetUserStatus, admin: true },
    adminRemoveUser: { f: adminRemoveUser, admin: true },
    adminListRoles: { f: adminListRoles, admin: true },
    adminSaveRole: { f: adminSaveRole, admin: true },
    adminDeleteRole: { f: adminDeleteRole, admin: true },
    adminListRequests: { f: adminListRequests, admin: true },
    adminResolveRequest: { f: adminResolveRequest, admin: true },
    adminSendInvite: { f: adminSendInvite, admin: true },
  };
}

function _dispatch_(fn, token, args) {
  const pub = _publicFns_();
  if (Object.prototype.hasOwnProperty.call(pub, fn)) return pub[fn].apply(null, args);
  const table = _authedFns_();
  if (!Object.prototype.hasOwnProperty.call(table, fn)) return { success: false, error: 'Unknown function: ' + fn };
  const spec = table[fn];
  const user = _userFromToken_(token);
  if (!user) return { success: false, error: 'auth_required' };
  if (spec.admin && !user.isAdmin) return { success: false, error: 'forbidden' };
  if (spec.page && user.perms.pages.indexOf(spec.page) === -1) return { success: false, error: 'forbidden' };
  return spec.f.apply(null, [user].concat(args));
}

// ---- Setup --------------------------------------------------------------
function setupPortal() {
  _tab_(USERS_TAB, USERS_HEADER);
  _tab_(SESSIONS_TAB, SESSIONS_HEADER);
  _tab_(ACCESS_REQUESTS_TAB_NAME, REQUEST_HEADER);
  const cs = _tab_(COMMENTS_TAB_NAME, HEADER);
  const h = cs.getRange(1, 1, 1, Math.max(cs.getLastColumn(), 1)).getValues()[0];
  if (h.indexOf('Email') === -1) cs.getRange(1, h.length + 1).setValue('Email');

  const rs = _tab_(ROLES_TAB, ROLES_HEADER);
  if (rs.getLastRow() < 2) {
    DEFAULT_ROLES.forEach(function (r) {
      rs.appendRow([r.id, r.label, JSON.stringify(r.perms), r.system ? 'TRUE' : 'FALSE']);
    });
  }
  const us = _tab_(USERS_TAB, USERS_HEADER);
  const ss = SpreadsheetApp.openById(COMMENTS_SHEET_ID);
  const wl = ss.getSheetByName(WHITELIST_TAB_NAME);
  let migrated = 0;
  if (wl && wl.getLastRow() > 1) {
    const existing = _users_().map(function (u) { return u.email; });
    wl.getDataRange().getValues().slice(1).forEach(function (r) {
      const em = _normEmail_(r[0]);
      if (em && existing.indexOf(em) === -1 && em !== ROOT_ADMIN) {
        us.appendRow([em, r[1] || '', 'team', 'active', 'migration', new Date(), '']);
        existing.push(em);
        migrated++;
      }
    });
  }
  if (!_findUser_(ROOT_ADMIN)) us.appendRow([ROOT_ADMIN, 'CRD', 'admin', 'active', 'system', new Date(), '']);
  MailApp.sendEmail(ROOT_ADMIN, PORTAL_NAME + ' — setup complete',
    'Portal tabs are ready. Migrated ' + migrated + ' people from the old Whitelist as Team members.');
  const msg = 'Setup done. Migrated ' + migrated + ' whitelist entries. Check ' + ROOT_ADMIN + ' for a test email.';
  Logger.log(msg);
  return { success: true, message: msg };
}

// ---- Sheet helpers ------------------------------------------------------
function _tab_(name, header) {
  const ss = SpreadsheetApp.openById(COMMENTS_SHEET_ID);
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0) sheet.appendRow(header);
  return sheet;
}
function _normEmail_(e) { return String(e || '').trim().toLowerCase(); }
function _validEmail_(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }
function _hash_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s)
    .map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}
function _rand_() { return Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid(); }
function _bool_01_(v) { return v === true || String(v).toUpperCase() === 'TRUE'; }
function _iso_(d) { return d instanceof Date ? d.toISOString() : String(d || ''); }

function _users_() {
  const v = _tab_(USERS_TAB, USERS_HEADER).getDataRange().getValues();
  const out = [];
  for (let i = 1; i < v.length; i++) {
    if (!v[i][0]) continue;
    out.push({ row: i + 1, email: _normEmail_(v[i][0]), name: String(v[i][1] || ''), role: String(v[i][2] || ''),
      status: String(v[i][3] || 'active'), addedBy: String(v[i][4] || ''), addedDate: v[i][5], lastLogin: v[i][6] });
  }
  return out;
}
function _findUser_(email) {
  const e = _normEmail_(email);
  const us = _users_();
  for (let i = 0; i < us.length; i++) if (us[i].email === e) return us[i];
  return null;
}
function _roles_() {
  const v = _tab_(ROLES_TAB, ROLES_HEADER).getDataRange().getValues();
  const out = {};
  for (let i = 1; i < v.length; i++) {
    if (!v[i][0]) continue;
    let perms;
    try { perms = JSON.parse(v[i][2]); } catch (e) { perms = null; }
    out[String(v[i][0])] = { id: String(v[i][0]), label: String(v[i][1]), perms: _cleanPerms_(perms),
      system: _bool_01_(v[i][3]), row: i + 1 };
  }
  return out;
}
function _cleanPerms_(p) {
  p = p || {};
  const pages = (p.pages || []).filter(function (x) { return ALL_PAGES.indexOf(x) !== -1; });
  const c = ['none', 'view', 'post'].indexOf(p.comments) !== -1 ? p.comments : 'none';
  return { pages: pages, comments: c, refresh: !!p.refresh, pdf: !!p.pdf, feedback: !!p.feedback };
}
function _adminEmails_() {
  const s = {};
  s[ROOT_ADMIN] = true;
  _users_().forEach(function (u) { if (u.role === 'admin' && u.status === 'active') s[u.email] = true; });
  return Object.keys(s);
}
function _publicUser_(u) {
  return { email: u.email, name: u.name, role: u.role, roleLabel: u.roleLabel, isAdmin: u.isAdmin,
    isRoot: u.isRoot, perms: u.perms, pageLabels: PAGE_LABELS };
}

// ---- Sign-in: emailed code ---------------------------------------------
function requestCode(email) {
  const generic = { success: true, message: 'If that email has access, a 6-digit code is on its way.' };
  const em = _normEmail_(email);
  if (!_validEmail_(em)) return { success: false, error: 'Please enter a valid email address.' };
  const cache = CacheService.getScriptCache();
  const rlKey = 'rl:' + _hash_(em);
  const n = parseInt(cache.get(rlKey) || '0', 10);
  if (n >= OTP_MAX_REQUESTS_PER_HOUR) {
    return { success: false, error: 'Too many requests. Please try again in an hour.' };
  }
  cache.put(rlKey, String(n + 1), 3600);
  const u = _findUser_(em);
  if (!u || u.status !== 'active') return generic; // do not reveal who has access
  const code = ('000000' + (parseInt(_hash_(_rand_() + Date.now()).slice(0, 8), 16) % 1000000)).slice(-6);
  const salt = _rand_();
  cache.put('otp:' + _hash_(em), JSON.stringify({ h: _hash_(salt + code), salt: salt, tries: 0 }), OTP_TTL_SEC);
  try {
    MailApp.sendEmail({
      to: em,
      subject: 'Your sign-in code: ' + code,
      body: 'Your one-time sign-in code for the ' + PORTAL_NAME + ' is:\n\n    ' + code +
        '\n\nIt expires in 15 minutes. If you did not request it, you can ignore this email.',
      htmlBody: '<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;color:#2b1b16">' +
        '<h2 style="color:#693D30;margin:0 0 12px">' + PORTAL_NAME + '</h2>' +
        '<p>Your one-time sign-in code is:</p>' +
        '<p style="font-size:32px;letter-spacing:8px;font-weight:700;background:#f4eeeb;padding:14px 18px;border-radius:8px;display:inline-block">' + code + '</p>' +
        '<p style="color:#666">It expires in 15 minutes. If you did not request it, you can ignore this email.</p></div>',
    });
  } catch (err) {
    Logger.log('OTP email failed: ' + err);
  }
  return generic;
}

function verifyCode(email, code) {
  const bad = { success: false, error: 'That code is invalid or has expired.' };
  const em = _normEmail_(email);
  const cache = CacheService.getScriptCache();
  const key = 'otp:' + _hash_(em);
  const raw = cache.get(key);
  if (!raw) return bad;
  const rec = JSON.parse(raw);
  if (rec.tries >= OTP_MAX_TRIES) { cache.remove(key); return bad; }
  if (_hash_(rec.salt + String(code || '').trim()) !== rec.h) {
    rec.tries++;
    cache.put(key, JSON.stringify(rec), OTP_TTL_SEC);
    return bad;
  }
  cache.remove(key);
  const u = _findUser_(em);
  if (!u || u.status !== 'active') return bad;
  const token = _rand_().replace(/-/g, '');
  const exp = new Date(Date.now() + SESSION_DAYS * 86400000);
  _tab_(SESSIONS_TAB, SESSIONS_HEADER).appendRow([_hash_(token), em, new Date(), exp, 'FALSE']);
  _tab_(USERS_TAB, USERS_HEADER).getRange(u.row, 7).setValue(new Date());
  _pruneSessions_();
  const user = _userFromToken_(token);
  return { success: true, token: token, user: _publicUser_(user) };
}

function _pruneSessions_() {
  const sh = _tab_(SESSIONS_TAB, SESSIONS_HEADER);
  if (sh.getLastRow() < 400) return;
  const v = sh.getDataRange().getValues();
  const now = Date.now();
  for (let i = v.length - 1; i >= 1; i--) {
    if (_bool_01_(v[i][4]) || new Date(v[i][3]).getTime() < now) sh.deleteRow(i + 1);
  }
}

function _userFromToken_(token) {
  if (!token || typeof token !== 'string' || token.length < 40) return null;
  const th = _hash_(token);
  const cache = CacheService.getScriptCache();
  let email = cache.get('sess:' + th);
  if (!email) {
    const v = _tab_(SESSIONS_TAB, SESSIONS_HEADER).getDataRange().getValues();
    for (let i = v.length - 1; i >= 1; i--) {
      if (v[i][0] === th) {
        if (!_bool_01_(v[i][4]) && new Date(v[i][3]).getTime() > Date.now()) email = _normEmail_(v[i][1]);
        break;
      }
    }
    if (!email) return null;
    cache.put('sess:' + th, email, 600);
  }
  const u = _findUser_(email);
  if (!u || u.status !== 'active') return null;
  const roles = _roles_();
  const isRoot = u.email === ROOT_ADMIN;
  const roleId = isRoot ? 'admin' : u.role;
  const role = roles[roleId] || { id: roleId, label: roleId, perms: _cleanPerms_(null) };
  const isAdmin = isRoot || roleId === 'admin';
  const perms = isAdmin ? _cleanPerms_(DEFAULT_ROLES[0].perms) : role.perms;
  return { email: u.email, name: u.name || u.email.split('@')[0], role: roleId, roleLabel: role.label,
    isAdmin: isAdmin, isRoot: isRoot, perms: perms, tokenHash: th, row: u.row };
}

function _revokeSessions_(email, exceptHash) {
  const sh = _tab_(SESSIONS_TAB, SESSIONS_HEADER);
  const v = sh.getDataRange().getValues();
  const cache = CacheService.getScriptCache();
  for (let i = 1; i < v.length; i++) {
    if (_normEmail_(v[i][1]) === _normEmail_(email) && v[i][0] !== exceptHash && !_bool_01_(v[i][4])) {
      sh.getRange(i + 1, 5).setValue('TRUE');
      cache.remove('sess:' + v[i][0]);
    }
  }
}

// ---- Profile ---------------------------------------------------------------
function getMe(user) { return { success: true, user: _publicUser_(user) }; }

function updateProfile(user, name) {
  const n = String(name || '').trim().slice(0, 80);
  if (!n) return { success: false, error: 'Name cannot be empty.' };
  _tab_(USERS_TAB, USERS_HEADER).getRange(user.row, 2).setValue(n);
  user.name = n;
  return { success: true, user: _publicUser_(user) };
}

function signOut(user) {
  const sh = _tab_(SESSIONS_TAB, SESSIONS_HEADER);
  const v = sh.getDataRange().getValues();
  for (let i = 1; i < v.length; i++) {
    if (v[i][0] === user.tokenHash) { sh.getRange(i + 1, 5).setValue('TRUE'); break; }
  }
  CacheService.getScriptCache().remove('sess:' + user.tokenHash);
  return { success: true };
}
function signOutEverywhere(user) { _revokeSessions_(user.email, null); return { success: true }; }

// ---- Access requests (public) ------------------------------------------------
function requestAccess(name, email, reason) {
  const em = _normEmail_(email);
  if (!_validEmail_(em)) return { success: false, error: 'Please enter a valid email address.' };
  const ok = { success: true, message: 'Thanks — your request has been sent. You will get an email if it is approved.' };
  const u = _findUser_(em);
  if (u && u.status === 'active') return { success: true, message: 'You already have access — use "Email me a code" to sign in.' };
  const cache = CacheService.getScriptCache();
  const k = 'rq:' + _hash_(em);
  if (cache.get(k)) return ok;
  cache.put(k, '1', 3600);
  const cleanName = String(name || '').trim().slice(0, 80);
  const cleanReason = String(reason || '').trim().slice(0, 500);
  _tab_(ACCESS_REQUESTS_TAB_NAME, REQUEST_HEADER).appendRow([em, cleanName, cleanReason, new Date(), 'pending']);
  _notifyAdmins_('Access request — ' + em,
    (cleanName || 'Someone') + ' (' + em + ') asked for access to the ' + PORTAL_NAME + '.' +
    (cleanReason ? '\n\nReason: "' + cleanReason + '"' : '') +
    '\n\nReview it in Admin → Access requests' + (SITE_URL ? ': ' + SITE_URL : '.'));
  return ok;
}

function _notifyAdmins_(subject, body, replyTo) {
  const to = _adminEmails_();
  if (!to.length) return;
  try {
    const o = { to: to.join(','), subject: '[EIP Portal] ' + subject, body: body };
    if (replyTo && _validEmail_(replyTo)) o.replyTo = replyTo;
    MailApp.sendEmail(o);
  } catch (e) { Logger.log('Admin notification failed: ' + e); }
}

// ---- Admin: users ------------------------------------------------------------
function adminListUsers(user) {
  const roles = _roles_();
  return { success: true, users: _users_().map(function (u) {
    const rid = u.email === ROOT_ADMIN ? 'admin' : u.role;
    return { email: u.email, name: u.name, role: rid, roleLabel: (roles[rid] || {}).label || rid,
      status: u.status, addedBy: u.addedBy, isRoot: u.email === ROOT_ADMIN,
      addedDate: _iso_(u.addedDate), lastLogin: _iso_(u.lastLogin) };
  }) };
}

function _canAssignRole_(actor, roleId) {
  if (!_roles_()[roleId]) return 'Unknown role.';
  if (roleId === 'admin' && !actor.isRoot) return 'Only ' + ROOT_ADMIN + ' can grant the Admin role.';
  return '';
}

function adminSaveUser(actor, email, name, roleId, sendInvite) {
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const em = _normEmail_(email);
    if (!_validEmail_(em)) return { success: false, error: 'Enter a valid email.' };
    if (em === ROOT_ADMIN) return { success: false, error: 'The root admin cannot be edited.' };
    const err = _canAssignRole_(actor, roleId);
    if (err) return { success: false, error: err };
    const existing = _findUser_(em);
    const sh = _tab_(USERS_TAB, USERS_HEADER);
    if (existing) {
      if (existing.role === 'admin' && !actor.isRoot) return { success: false, error: 'Only ' + ROOT_ADMIN + ' can change an Admin.' };
      sh.getRange(existing.row, 2, 1, 2).setValues([[String(name || existing.name).trim(), roleId]]);
      if (existing.role !== roleId) _revokeSessions_(em, null);
    } else {
      sh.appendRow([em, String(name || '').trim(), roleId, 'active', actor.email, new Date(), '']);
    }
    if (sendInvite) _sendInvite_(em, String(name || '').trim(), actor.name);
    return { success: true };
  } finally { lock.releaseLock(); }
}

function adminSetUserStatus(actor, email, status) {
  const em = _normEmail_(email);
  if (em === ROOT_ADMIN) return { success: false, error: 'The root admin cannot be disabled.' };
  if (status !== 'active' && status !== 'disabled') return { success: false, error: 'Bad status.' };
  const u = _findUser_(em);
  if (!u) return { success: false, error: 'User not found.' };
  if (u.role === 'admin' && !actor.isRoot) return { success: false, error: 'Only ' + ROOT_ADMIN + ' can change an Admin.' };
  _tab_(USERS_TAB, USERS_HEADER).getRange(u.row, 4).setValue(status);
  if (status === 'disabled') _revokeSessions_(em, null);
  return { success: true };
}

function adminRemoveUser(actor, email) {
  const em = _normEmail_(email);
  if (em === ROOT_ADMIN) return { success: false, error: 'The root admin cannot be removed.' };
  const u = _findUser_(em);
  if (!u) return { success: false, error: 'User not found.' };
  if (u.role === 'admin' && !actor.isRoot) return { success: false, error: 'Only ' + ROOT_ADMIN + ' can remove an Admin.' };
  _revokeSessions_(em, null);
  _tab_(USERS_TAB, USERS_HEADER).deleteRow(u.row);
  return { success: true };
}

function adminSendInvite(actor, email) {
  const u = _findUser_(email);
  if (!u || u.status !== 'active') return { success: false, error: 'User not found or disabled.' };
  _sendInvite_(u.email, u.name, actor.name);
  return { success: true };
}

function _sendInvite_(email, name, inviter) {
  try {
    MailApp.sendEmail({
      to: email,
      subject: 'You now have access to the ' + PORTAL_NAME,
      body: 'Hi ' + (name || '') + ',\n\n' + (inviter || 'The/Nudge') + ' has given you access to the ' + PORTAL_NAME + '.\n\n' +
        (SITE_URL ? 'Open: ' + SITE_URL + '\n' : '') +
        'Enter this email address and we will send you a 6-digit sign-in code. No password needed.\n',
    });
  } catch (e) { Logger.log('Invite failed: ' + e); }
}

// ---- Admin: roles ------------------------------------------------------------
function adminListRoles(user) {
  const r = _roles_();
  const counts = {};
  _users_().forEach(function (u) { counts[u.role] = (counts[u.role] || 0) + 1; });
  return { success: true, pages: ALL_PAGES.map(function (p) { return { id: p, label: PAGE_LABELS[p] }; }),
    roles: Object.keys(r).map(function (k) {
      return { id: k, label: r[k].label, perms: k === 'admin' ? _cleanPerms_(DEFAULT_ROLES[0].perms) : r[k].perms,
        system: r[k].system, users: counts[k] || 0 };
    }) };
}

function adminSaveRole(actor, id, label, perms) {
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const roleId = String(id || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 40);
    const lab = String(label || '').trim().slice(0, 60);
    if (!roleId || !lab) return { success: false, error: 'Role needs a name.' };
    if (roleId === 'admin') return { success: false, error: 'The Admin role is fixed (full access).' };
    const clean = _cleanPerms_(perms);
    const sh = _tab_(ROLES_TAB, ROLES_HEADER);
    const roles = _roles_();
    if (roles[roleId]) {
      sh.getRange(roles[roleId].row, 2, 1, 2).setValues([[lab, JSON.stringify(clean)]]);
    } else {
      sh.appendRow([roleId, lab, JSON.stringify(clean), 'FALSE']);
    }
    // Permission changes take effect immediately: session cache holds only email.
    return { success: true, id: roleId };
  } finally { lock.releaseLock(); }
}

function adminDeleteRole(actor, id) {
  const r = _roles_()[id];
  if (!r) return { success: false, error: 'Role not found.' };
  if (id === 'admin' || r.system) return { success: false, error: 'System roles cannot be deleted.' };
  const inUse = _users_().filter(function (u) { return u.role === id; }).length;
  if (inUse) return { success: false, error: inUse + ' user(s) still have this role. Move them first.' };
  _tab_(ROLES_TAB, ROLES_HEADER).deleteRow(r.row);
  return { success: true };
}

// ---- Admin: access requests --------------------------------------------------
function adminListRequests(user) {
  const v = _tab_(ACCESS_REQUESTS_TAB_NAME, REQUEST_HEADER).getDataRange().getValues();
  const out = [];
  for (let i = 1; i < v.length; i++) {
    if (!v[i][0]) continue;
    out.push({ email: _normEmail_(v[i][0]), name: String(v[i][1] || ''), reason: String(v[i][2] || ''),
      date: _iso_(v[i][3]), status: String(v[i][4] || 'pending') });
  }
  return { success: true, requests: out.reverse() };
}

function adminResolveRequest(actor, email, decision, roleId) {
  const em = _normEmail_(email);
  const sh = _tab_(ACCESS_REQUESTS_TAB_NAME, REQUEST_HEADER);
  const v = sh.getDataRange().getValues();
  let row = -1, name = '';
  for (let i = v.length - 1; i >= 1; i--) {
    if (_normEmail_(v[i][0]) === em && String(v[i][4] || 'pending') === 'pending') { row = i + 1; name = v[i][1]; break; }
  }
  if (row === -1) return { success: false, error: 'No pending request for that email.' };
  if (decision === 'approve') {
    const r = adminSaveUser(actor, em, name, roleId, true);
    if (!r.success) return r;
    sh.getRange(row, 5).setValue('approved');
  } else {
    sh.getRange(row, 5).setValue('declined');
  }
  return { success: true };
}

// ---- Content & photos (private Drive assets folder) --------------------------
function _assetJson_(fileName) {
  let folder;
  try { folder = DriveApp.getFolderById(ASSETS_FOLDER_ID); }
  catch (e) { throw new Error('Assets folder not reachable — check ASSETS_FOLDER_ID in Code.gs (and that this account can open the folder).'); }
  const it = folder.getFilesByName(fileName);
  if (!it.hasNext()) return null;
  return JSON.parse(it.next().getBlob().getDataAsString());
}

/** content.json: { product:{...}, field:{...}, glossary:{...} } keyed by page id. */
function getContent(user, pageId) {
  if (user.perms.pages.indexOf(pageId) === -1) return { success: false, error: 'forbidden' };
  const all = _assetJson_('content.json');
  if (!all) return { success: false, error: 'content.json was not found in the Drive assets folder (ASSETS_FOLDER_ID). Upload portal-assets/content.json there.' };
  return { success: true, content: all[pageId] || null, glossary: all.glossary || {} };
}

/** photos_<key>.json — one per project/team, served on demand. */
function getPhotos(user, key) {
  if (!/^[a-z0-9_-]{1,60}$/i.test(String(key || ''))) return { success: false, error: 'Bad key.' };
  const p = user.perms.pages;
  if (p.indexOf('field') === -1 && p.indexOf('map') === -1 && p.indexOf('progress') === -1) {
    return { success: false, error: 'forbidden' };
  }
  return { success: true, photos: _assetJson_('photos_' + key + '.json') };
}

// ---- Comments ---------------------------------------------------------------
function _cc_(name) { return HEADER.indexOf(name); }

function getComments(user, section) {
  if (user.perms.comments === 'none') return { success: true, comments: [], canPost: false };
  const values = _tab_(COMMENTS_TAB_NAME, HEADER).getDataRange().getValues();
  const out = [];
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    if (!r[_cc_('Comment')]) continue;
    if (section && r[_cc_('Section')] !== section) continue;
    if (user.perms.pages.indexOf(String(r[_cc_('Section')])) === -1) continue;
    out.push({
      id: String(r[_cc_('ID')]), parentId: r[_cc_('ParentID')] ? String(r[_cc_('ParentID')]) : '',
      section: r[_cc_('Section')], name: r[_cc_('Name')] || 'Anonymous', comment: r[_cc_('Comment')],
      timestamp: _iso_(r[_cc_('Timestamp')]), resolved: _bool_01_(r[_cc_('Resolved')]),
    });
  }
  return { success: true, comments: out, canPost: user.perms.comments === 'post' };
}

function addComment(user, section, text, parentId) {
  if (user.perms.comments !== 'post') return { success: false, error: 'forbidden' };
  if (user.perms.pages.indexOf(section) === -1) return { success: false, error: 'forbidden' };
  const clean = String(text || '').trim().slice(0, 4000);
  if (!clean) return { success: false, error: 'Comment text is empty.' };
  const id = Utilities.getUuid();
  const row = [];
  row[_cc_('ID')] = id; row[_cc_('ParentID')] = parentId || ''; row[_cc_('Section')] = section;
  row[_cc_('Name')] = user.name; row[_cc_('Comment')] = clean; row[_cc_('Timestamp')] = new Date();
  row[_cc_('Resolved')] = false; row[_cc_('Email')] = user.email;
  _tab_(COMMENTS_TAB_NAME, HEADER).appendRow(row);
  const label = SECTION_LABELS[section] || section;
  _notifyAdmins_((parentId ? 'New reply' : 'New comment') + ' — ' + label,
    user.name + ' (' + user.email + ') ' + (parentId ? 'replied' : 'commented') + ' on "' + label + '":\n\n"' + clean + '"' +
    (SITE_URL ? '\n\n' + SITE_URL : ''), user.email);
  return { success: true, id: id };
}

function resolveComment(user, id) {
  if (user.perms.comments !== 'post') return { success: false, error: 'forbidden' };
  const sh = _tab_(COMMENTS_TAB_NAME, HEADER);
  const v = sh.getDataRange().getValues();
  for (let i = 1; i < v.length; i++) {
    if (String(v[i][_cc_('ID')]) === String(id)) {
      if (user.perms.pages.indexOf(String(v[i][_cc_('Section')])) === -1) return { success: false, error: 'forbidden' };
      sh.getRange(i + 1, _cc_('Resolved') + 1).setValue(true);
      return { success: true };
    }
  }
  return { success: false, error: 'Comment not found.' };
}

function submitFeedback(user, message) {
  if (!user.perms.feedback) return { success: false, error: 'forbidden' };
  const m = String(message || '').trim().slice(0, 4000);
  if (!m) return { success: false, error: 'Message is empty.' };
  _notifyAdmins_('Feedback from ' + user.name,
    user.name + ' (' + user.email + ') sent feedback:\n\n"' + m + '"\n\nReply directly to this email to respond.', user.email);
  return { success: true };
}

// ---- Map: projects + partnerships together ------------------------------------
/** Quarterly programme trend from the first tab of the trend sheet (rows 1-10). */
function getTrendData() {
  const sh = SpreadsheetApp.openById(TREND_SHEET_ID).getSheets()[0];
  const v = sh.getRange(1, 1, 10, sh.getLastColumn()).getValues();
  const head = v[0];
  const cols = [];
  for (let c = 1; c < head.length; c++) {
    const h = _str_(head[c]);
    if (/^Q[1-4]\s*FY/i.test(h)) cols.push({ c: c, label: h.replace(/\s+/g, ' ') });
  }
  if (!cols.length) throw new Error('Trend sheet: could not find quarter columns (e.g. "Q1 FY\'23") in row 1.');
  const series = [];
  for (let r = 1; r < v.length; r++) {
    const name = _str_(v[r][0]);
    if (!name) continue;
    series.push({ name: name, values: cols.map(function (x) { return _num_(v[r][x.c]); }) });
  }
  return { success: true, quarters: cols.map(function (x) { return x.label; }), series: series, fetchedAt: new Date().toISOString() };
}

function getMapData(user) {
  return { success: true, progress: getProgressData(), ecosystem: getEcosystemData() };
}

/* =======================================================================
 * LIVE DATA — Progress / Deals / Research / Ecosystem "Refresh" buttons.
 *
 * These read the SAME tracker Sheet + Research Sheet that CRD's team
 * already keeps up to date, and return plain JSON that the front-end
 * re-renders each table from. Nothing here writes to any sheet.
 *
 * Column matching is done BY HEADER NAME, not position, so reordering a
 * column in the source sheet won't silently break this — only renaming a
 * header, or removing/renaming a tab, would (Apps Script will throw a
 * clear error naming the missing header/tab in that case, visible in the
 * "Refresh" button's error state on the page).
 * ======================================================================= */

function _readTab_(sheetId, tabName) {
  const ss = SpreadsheetApp.openById(sheetId);
  const sheet = ss.getSheetByName(tabName);
  if (!sheet) throw new Error('Tab not found: "' + tabName + '" — has it been renamed in the source sheet?');
  return { sheet: sheet, values: sheet.getDataRange().getValues() };
}

/**
 * Finds the row that contains `anchorHeader` (case-insensitive, exact
 * cell match) within the first 8 rows, and builds a header array for that
 * row. Some tabs have a merged group-label row directly above the real
 * headers (e.g. "HHs Received Financial Support" spanning 3 columns above
 * "Current" / "Exp. by This quarter" / "End of FY 2027") — several groups
 * reuse the same 3 sub-labels, so reading sub-labels alone would collide.
 * To disambiguate, this reads the ACTUAL merged-cell ranges of that row
 * above (via Range.getMergedRanges(), not a blind forward-fill across
 * blanks — a blank cell after a real merge is NOT part of that merge, and
 * a naive fill would incorrectly attach the group label to unrelated
 * columns further right) and only prefixes a sub-label with its group
 * name where a real merge spans them together, e.g.
 * "HHs Received Financial Support | Current".
 */
function _findHeaders_(sheet, values, anchorHeader) {
  const anchorLower = anchorHeader.trim().toLowerCase();
  let headerRow = -1;
  for (let r = 0; r < Math.min(values.length, 8); r++) {
    for (let c = 0; c < values[r].length; c++) {
      if (String(values[r][c]).trim().toLowerCase() === anchorLower) { headerRow = r; break; }
    }
    if (headerRow !== -1) break;
  }
  if (headerRow === -1) {
    throw new Error('Could not find a column header "' + anchorHeader + '" — has it been renamed in the source sheet?');
  }
  const subRow = values[headerRow];
  const numCols = subRow.length;
  const groupRow = new Array(numCols).fill('');
  if (headerRow > 0) {
    // headerRow is 0-based into `values`; the row above it is sheet row
    // `headerRow` in Apps Script's 1-based Range coordinates.
    const groupSheetRow = headerRow;
    const rawGroupRow = values[headerRow - 1];
    for (let i = 0; i < numCols; i++) groupRow[i] = String(rawGroupRow[i] || '').trim();
    const merges = sheet.getRange(groupSheetRow, 1, 1, numCols).getMergedRanges();
    merges.forEach(function (rng) {
      const val = String(rng.getCell(1, 1).getValue() || '').trim();
      const startCol = rng.getColumn(); // 1-based
      const span = rng.getNumColumns();
      for (let c = startCol; c < startCol + span; c++) groupRow[c - 1] = val;
    });
  }
  // Only prefix a sub-label with its group name when that sub-label is
  // AMBIGUOUS — i.e. it repeats elsewhere in this same row (like "Current"
  // appearing under 5 different metric groups). A sub-label that's unique
  // in the row (like the 4 distinct deal-stage names, which also happen to
  // sit under a merged "Stage" group) is left exactly as-is — prefixing it
  // would just break every lookup for that column name.
  const subCounts = {};
  for (let i = 0; i < numCols; i++) {
    const sub = String(subRow[i] || '').trim().toLowerCase();
    if (sub) subCounts[sub] = (subCounts[sub] || 0) + 1;
  }
  const headers = [];
  for (let i = 0; i < numCols; i++) {
    const g = groupRow[i];
    const sub = String(subRow[i] || '').trim();
    const isDuplicate = sub && subCounts[sub.toLowerCase()] > 1;
    if (!sub) {
      headers.push(g);
    } else if (isDuplicate && g && sub.toLowerCase() !== g.toLowerCase()) {
      headers.push(g + ' | ' + sub);
    } else {
      headers.push(sub);
    }
  }
  return { headerRow: headerRow, headers: headers };
}

function _colIdx_(headers, name) {
  const target = name.trim().toLowerCase();
  for (let i = 0; i < headers.length; i++) {
    if (headers[i].toLowerCase() === target) return i;
  }
  return -1;
}

function _requireCol_(headers, name) {
  const i = _colIdx_(headers, name);
  if (i === -1) throw new Error('Could not find column "' + name + '" — has it been renamed in the source sheet?');
  return i;
}

/** Rightmost "Progress Note - <Month>" column = the latest month's note. */
function _latestProgressNoteCol_(headers) {
  let best = -1;
  for (let i = 0; i < headers.length; i++) {
    if (/progress note/i.test(headers[i])) best = i;
  }
  return best;
}

function _num_(v) {
  if (v === null || v === undefined || v === '') return 0;
  const n = parseFloat(String(v).replace(/,/g, '').trim());
  return isNaN(n) ? 0 : n;
}

function _bool_(v) {
  return String(v).trim().toUpperCase() === 'TRUE';
}

function _str_(v) {
  return v === null || v === undefined ? '' : String(v).trim();
}

/**
 * A sheet cell formatted as a date comes back from getValues() as a real
 * JS Date object, not text — stringifying it directly (as _str_ does)
 * produces the verbose "Wed Oct 01 2025 00:00:00 GMT+0530 (India Standard
 * Time)" form. This renders it as "MMM yyyy" to match the report's style
 * (e.g. "Oct 2025"). Falls back to plain text for cells that aren't
 * actually date-typed (e.g. "TBD").
 */
function _fmtMonth_(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, 'Asia/Kolkata', 'MMM yyyy');
  }
  return _str_(v);
}

/** Data rows only (after the header row), skipping fully-blank rows. */
function _dataRows_(values, headerRow) {
  return values.slice(headerRow + 1).filter(function (row) {
    return row.some(function (cell) { return String(cell).trim() !== ''; });
  });
}

/**
 * Several tabs have a "Totals" row followed by extra pipeline/prospective
 * rows (often just "TBD" placeholders) below the real, currently-reported
 * list — those aren't meant to appear on the live report. This keeps only
 * the rows ABOVE the first row whose name-column reads "Totals" (or
 * "Total"), and drops that marker row itself along with everything after.
 * If no such marker row exists, every row is kept unchanged.
 */
function _stopBeforeTotals_(rows, nameColIdx) {
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const nm = _str_(rows[i][nameColIdx]).toLowerCase();
    if (nm === 'totals' || nm === 'total') break;
    out.push(rows[i]);
  }
  return out;
}

function getProgressData() {
  const tab = _readTab_(TRACKER_SHEET_ID, PROGRESS_TAB);
  const values = tab.values;
  const found = _findHeaders_(tab.sheet, values, 'Project (HHs)');
  const h = found.headers;
  const iName = _requireCol_(h, 'Project (HHs)');
  const iFunding = _requireCol_(h, 'Funding Source');
  const iPType = _requireCol_(h, 'Project Type');
  const iIType = _requireCol_(h, 'Intervention Type');
  const iApprovedDate = _requireCol_(h, 'Approved Date');
  const iEndDate = _requireCol_(h, 'End Date');
  const iBudgetCr = _requireCol_(h, 'Approved Budget (in CR)');
  const iPlan = _requireCol_(h, '#HHs in plan');
  const iActive = _requireCol_(h, 'Active HHs');
  const iInactive = _requireCol_(h, 'HHs inactive');
  const iFin = _requireCol_(h, 'HHs Received Financial Support | Current');

  const rows = _stopBeforeTotals_(_dataRows_(values, found.headerRow), iName)
    .filter(function (r) { return _str_(r[iName]); })
    .map(function (r) {
      const budgetCr = _num_(r[iBudgetCr]);
      return {
        name: _str_(r[iName]),
        fundingSource: _str_(r[iFunding]),
        projectType: _str_(r[iPType]),
        interventionType: _str_(r[iIType]),
        timeline: _fmtMonth_(r[iApprovedDate]) + ' – ' + _fmtMonth_(r[iEndDate]),
        budgetCr: budgetCr,
        budgetUsdMn: budgetCr / 9,
        plan: _num_(r[iPlan]),
        active: _num_(r[iActive]),
        inactive: _num_(r[iInactive]),
        fin: _num_(r[iFin]),
      };
    });
  return { success: true, rows: rows, fetchedAt: new Date().toISOString() };
}

function getDealsData() {
  const tab = _readTab_(TRACKER_SHEET_ID, DEALS_TAB);
  const values = tab.values;
  const found = _findHeaders_(tab.sheet, values, 'State / Program');
  const h = found.headers;
  const iName = _requireCol_(h, 'State / Program');
  const iState = _requireCol_(h, 'State');
  const iTargeted = _requireCol_(h, 'Targeted');
  const iBudgetCr = _requireCol_(h, 'Budget (Tentative) (Cr.)');
  const iModel = _requireCol_(h, 'Model');
  const iRemarks = _requireCol_(h, 'Remarks');
  const iWebsite = _requireCol_(h, DEALS_WEBSITE_COL);
  const stageCols = DEAL_STAGE_COLS.map(function (name) { return _requireCol_(h, name); });

  const rows = _stopBeforeTotals_(_dataRows_(values, found.headerRow), iName)
    .filter(function (r) { return _str_(r[iName]) && _bool_(r[iWebsite]); })
    .map(function (r) {
      const budgetCr = _num_(r[iBudgetCr]);
      return {
        name: _str_(r[iName]),
        state: _str_(r[iState]),
        targeted: _num_(r[iTargeted]),
        budgetCr: budgetCr,
        budgetUsdMn: budgetCr / 9,
        model: _str_(r[iModel]),
        flags: stageCols.map(function (c) { return _bool_(r[c]); }),
        remarks: _str_(r[iRemarks]),
      };
    });
  return { success: true, rows: rows, fetchedAt: new Date().toISOString() };
}

/** Combines the 3 Research & Evaluation tabs (each may lack a Report column). */
function _readResearchTab_(tabName, sourceLabel) {
  const tab = _readTab_(RESEARCH_SHEET_ID, tabName);
  const values = tab.values;
  const found = _findHeaders_(tab.sheet, values, 'Study Title');
  const h = found.headers;
  const iSl = _colIdx_(h, 'S No.') !== -1 ? _colIdx_(h, 'S No.') : _requireCol_(h, 'S. No.');
  const iTitle = _requireCol_(h, 'Study Title');
  const iPType = _requireCol_(h, 'Project Type');
  const iSType = _requireCol_(h, 'Type of study');
  const iPartner = _requireCol_(h, 'Partner');
  const iExec = _requireCol_(h, 'Execution');
  const iReport = _colIdx_(h, 'Report'); // -1 for In-concept studies, which has none
  const iLatest = _latestProgressNoteCol_(h);

  return _stopBeforeTotals_(_dataRows_(values, found.headerRow), iTitle)
    .filter(function (r) { return _str_(r[iTitle]); })
    .map(function (r) {
      return {
        title: _str_(r[iTitle]),
        projectType: _str_(r[iPType]),
        studyType: _str_(r[iSType]),
        partner: _str_(r[iPartner]),
        execution: _str_(r[iExec]),
        report: iReport !== -1 ? _str_(r[iReport]) : '',
        update: iLatest !== -1 ? _str_(r[iLatest]) : '',
        source: sourceLabel,
      };
    });
}

function getResearchData() {
  const rows = []
    .concat(_readResearchTab_(IN_CONCEPT_TAB, 'In-concept'))
    .concat(_readResearchTab_(IN_EXECUTION_TAB, 'In-execution'))
    .concat(_readResearchTab_(LIVELIHOOD_TAB, 'Livelihood Research'));
  rows.forEach(function (r, i) { r.sl = i + 1; });
  return { success: true, rows: rows, fetchedAt: new Date().toISOString() };
}

function getEcosystemData() {
  const pTab = _readTab_(TRACKER_SHEET_ID, PARTNERSHIP_TAB);
  const pValues = pTab.values;
  const pFound = _findHeaders_(pTab.sheet, pValues, 'Partner Name');
  const ph = pFound.headers;
  const piPartner = _requireCol_(ph, 'Partner Name');
  const piProject = _requireCol_(ph, 'Project');
  const piType = _requireCol_(ph, 'Partnership Type');
  const piFocus = _requireCol_(ph, 'Partnership Focus');
  const piStatus = _requireCol_(ph, 'Partnership Status');
  const partnerships = _stopBeforeTotals_(_dataRows_(pValues, pFound.headerRow), piPartner)
    .filter(function (r) { return _str_(r[piPartner]); })
    .map(function (r, i) {
      return {
        sl: i + 1,
        partner: _str_(r[piPartner]),
        project: _str_(r[piProject]),
        ptype: _str_(r[piType]),
        focus: _str_(r[piFocus]),
        status: _str_(r[piStatus]),
      };
    });

  const cTab = _readTab_(TRACKER_SHEET_ID, CONVENINGS_TAB);
  const cValues = cTab.values;
  const cFound = _findHeaders_(cTab.sheet, cValues, 'Topic');
  const ch = cFound.headers;
  const ciMonth = _requireCol_(ch, 'Month');
  const ciLocation = _requireCol_(ch, 'Location');
  const ciTopic = _requireCol_(ch, 'Topic');
  const ciAttendees = _requireCol_(ch, 'Attendees');
  const ciStatus = _requireCol_(ch, 'Status');
  const convenings = _stopBeforeTotals_(_dataRows_(cValues, cFound.headerRow), ciTopic)
    .filter(function (r) { return _str_(r[ciTopic]); })
    .map(function (r, i) {
      return {
        sl: i + 1,
        month: _fmtMonth_(r[ciMonth]),
        location: _str_(r[ciLocation]),
        topic: _str_(r[ciTopic]),
        attendees: _str_(r[ciAttendees]),
        status: _str_(r[ciStatus]),
      };
    });

  return { success: true, partnerships: partnerships, convenings: convenings, fetchedAt: new Date().toISOString() };
}
