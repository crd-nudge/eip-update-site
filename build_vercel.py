#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Takes the already-built static EIP_Stakeholder_Update.html and injects the
same inline, threaded comment blocks + feedback popup as build_appsscript.py
does — but wired to plain fetch() calls against /api/* Vercel serverless
functions instead of google.script.run. Writes the result to
vercel-app/index.html, the static file Vercel serves at the site root.
Run this AFTER build_page.py.
"""
import re

SRC = "/sessions/gallant-loving-rubin/mnt/Donor Report Automation/EIP_Stakeholder_Update.html"
OUT = "/sessions/gallant-loving-rubin/mnt/outputs/vercel-app/index.html"

with open(SRC, "r", encoding="utf-8") as f:
    html = f.read()

# Panels that get a comment thread. (Glossary is a reference list, not
# something to discuss, so it's skipped.)
SECTIONS = ["progress", "deals", "product", "research", "ecosystem", "field"]

def comments_block(section_id):
    return f"""
  <div class="comments-block" data-section="{section_id}">
    <h3 class="comments-heading">Comments</h3>
    <div class="comment-thread-list" data-section="{section_id}">
      <p class="section-note">Loading comments…</p>
    </div>
    <div class="new-comment-form">
      <input type="text" class="c-name" placeholder="Your name" maxlength="80">
      <input type="email" class="c-email" placeholder="Your email (must be approved to comment)" maxlength="120">
      <textarea class="c-text" placeholder="Add a comment…" rows="2" maxlength="2000"></textarea>
      <div class="comment-form-row">
        <button class="pdf-btn comment-submit-btn new-comment-btn" data-section="{section_id}">Post Comment</button>
        <span class="comment-status"></span>
      </div>
    </div>
  </div>"""

# ---- 1. Insert a comments block before each target panel's closing </section> ----
for section_id in SECTIONS:
    pattern = re.compile(
        r'(<section id="' + re.escape(section_id) + r'" class="panel[^"]*">.*?)(\n  </section>)',
        re.DOTALL,
    )
    new_html, n = pattern.subn(lambda m: m.group(1) + comments_block(section_id) + m.group(2), html, count=1)
    assert n == 1, f"Could not inject comments block into section '{section_id}'"
    html = new_html

# ---- 1b. Feedback button (header) + popup modal ----
FEEDBACK_BTN = '\n      <button class="pdf-btn" id="feedback-open-btn">&#128172; Feedback</button>'
html, n = re.subn(
    r'(<button class="pdf-btn" onclick="window\.print\(\)">&#11015; Download as PDF</button>)',
    r'\1' + FEEDBACK_BTN,
    html,
    count=1,
)
assert n == 1, "Could not inject feedback button into header"

FEEDBACK_MODAL = """
<div id="feedback-modal-overlay" class="modal-overlay" style="display:none;">
  <div class="modal-box">
    <button type="button" class="modal-close-btn" aria-label="Close">&times;</button>
    <h3 class="modal-heading">Send Feedback</h3>
    <p class="modal-sub">Have a thought on this update? Send it straight to the team — no approval needed.</p>
    <input type="text" id="fb-name" placeholder="Your name (optional)" maxlength="80">
    <input type="email" id="fb-email" placeholder="Your email (optional)" maxlength="120">
    <textarea id="fb-message" placeholder="Your feedback…" rows="4" maxlength="4000"></textarea>
    <div class="comment-form-row">
      <button class="pdf-btn comment-submit-btn" id="fb-submit-btn">Send</button>
      <span class="comment-status" id="fb-status"></span>
    </div>
  </div>
</div>
</body>"""
html, n = re.subn(r"\n</body>", FEEDBACK_MODAL, html, count=1)
assert n == 1, "Could not inject feedback modal"

# ---- 2. CSS (inserted right before </style>) ----
CSS = """
  .comments-block {
    margin-top: 26px;
    padding-top: 18px;
    border-top: 2px solid var(--border);
  }
  .comments-heading { font-size: 16px; color: var(--brown-dark); margin: 0 0 12px; }
  .comment-thread-list { display: flex; flex-direction: column; gap: 10px; margin-bottom: 14px; }
  .comment-item, .new-comment-form {
    background: #fff;
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 12px 16px;
  }
  .new-comment-form { display: flex; flex-direction: column; gap: 8px; }
  .new-comment-form input, .new-comment-form textarea,
  .reply-form input, .reply-form textarea {
    font-family: inherit;
    font-size: 13.5px;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--ink);
    background: var(--cream);
  }
  .new-comment-form textarea, .reply-form textarea { resize: vertical; }
  .comment-form-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .comment-submit-btn {
    background: var(--brown-dark) !important;
    border-color: var(--brown-dark) !important;
    color: #fff !important;
    padding: 7px 16px !important;
    font-size: 12.5px !important;
  }
  .comment-submit-btn:hover { background: var(--brown) !important; }
  .comment-status { font-size: 12.5px; color: #776254; }
  .request-access-btn {
    background: none; border: 1px solid var(--brown); color: var(--brown-dark);
    border-radius: 14px; padding: 3px 12px; font-size: 12px; font-weight: 600;
    font-family: inherit; cursor: pointer;
  }
  .request-access-btn:hover { background: var(--cream-2); }
  .comment-meta { font-size: 12px; color: #8a7a6c; margin-bottom: 4px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .comment-meta strong { color: var(--brown-dark); }
  .resolved-badge {
    background: #e4f2e6; color: var(--green);
    border-radius: 10px; padding: 1px 8px; font-weight: 600; font-size: 11px;
  }
  .comment-text { font-size: 13.5px; color: var(--ink); white-space: pre-wrap; margin-bottom: 8px; }
  .comment-actions { display: flex; gap: 14px; }
  .reply-toggle-btn, .resolve-btn {
    background: none; border: none; padding: 0; cursor: pointer;
    font-size: 12.5px; font-weight: 600; color: var(--brown); font-family: inherit;
  }
  .resolve-btn { color: var(--green); }
  .reply-toggle-btn:hover, .resolve-btn:hover { text-decoration: underline; }
  .resolve-wrap { display: inline-flex; align-items: center; gap: 8px; }
  .resolve-email-input {
    font-family: inherit; font-size: 12.5px; padding: 4px 8px;
    border: 1px solid var(--border); border-radius: 6px; color: var(--ink); background: var(--cream);
  }
  .reply-form { margin-top: 10px; display: flex; flex-direction: column; gap: 8px; }
  .reply-list { margin-top: 10px; padding-left: 18px; border-left: 2px solid var(--border); display: flex; flex-direction: column; gap: 10px; }

  .modal-overlay {
    position: fixed; inset: 0; background: rgba(30,20,15,0.45);
    display: flex; align-items: center; justify-content: center; z-index: 999;
    padding: 16px;
  }
  .modal-box {
    background: #fff; border-radius: 12px; padding: 24px; max-width: 420px; width: 100%;
    position: relative; box-shadow: 0 12px 40px rgba(0,0,0,0.25);
  }
  .modal-close-btn {
    position: absolute; top: 8px; right: 12px; background: none; border: none;
    font-size: 24px; line-height: 1; cursor: pointer; color: #8a7a6c; font-family: inherit;
  }
  .modal-close-btn:hover { color: var(--brown-dark); }
  .modal-heading { margin: 0 0 6px; color: var(--brown-dark); font-size: 17px; }
  .modal-sub { margin: 0 0 14px; font-size: 12.5px; color: #776254; }
  .modal-box input, .modal-box textarea {
    width: 100%; box-sizing: border-box; font-family: inherit; font-size: 13.5px;
    padding: 8px 10px; border: 1px solid var(--border); border-radius: 6px;
    color: var(--ink); background: var(--cream); margin-bottom: 10px;
  }
  .modal-box textarea { resize: vertical; }
</style>"""
html, n = re.subn(r"\n</style>", CSS, html, count=1)
assert n == 1, "Could not inject comments CSS"

# ---- 3. JS (inserted right before the closing </script> of the main script block) ----
JS = """
  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function fmtDate(iso) {
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleString();
  }

  // Calls one of our /api/* Vercel functions. Returns a Promise resolving
  // to the parsed JSON body (or rejecting with an Error on network/HTTP
  // failure), the same shape google.script.run used to hand back via its
  // success handler.
  function apiCall(path, method, body) {
    var opts = { method: method };
    if (body !== undefined) {
      opts.headers = { 'Content-Type': 'application/json' };
      opts.body = JSON.stringify(body);
    }
    return fetch(path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (!r.ok && !data.error) {
          throw new Error('Request failed (' + r.status + ')');
        }
        return data;
      });
    });
  }

  // Remembers the visitor's name/email in this browser so they don't have
  // to retype it on every comment, reply, or resolve. Purely local to the
  // visitor's own device.
  function getSavedIdentity() {
    try {
      return {
        name: localStorage.getItem('eip_commenter_name') || '',
        email: localStorage.getItem('eip_commenter_email') || ''
      };
    } catch (e) { return { name: '', email: '' }; }
  }

  function saveIdentity(name, email) {
    try {
      if (name) localStorage.setItem('eip_commenter_name', name);
      if (email) localStorage.setItem('eip_commenter_email', email);
    } catch (e) { /* ignore, e.g. private browsing */ }
  }

  function applySavedIdentity(root) {
    var saved = getSavedIdentity();
    if (!saved.name && !saved.email) return;
    (root || document).querySelectorAll('.c-name, .reply-name').forEach(function (el) {
      if (!el.value) el.value = saved.name;
    });
    (root || document).querySelectorAll('.c-email, .reply-email').forEach(function (el) {
      if (!el.value) el.value = saved.email;
    });
  }

  function renderReply(r) {
    return '<div class="reply-item" data-id="' + r.id + '">' +
      '<div class="comment-meta"><strong>' + escapeHtml(r.name) + '</strong>' +
      '<span class="comment-date">' + fmtDate(r.timestamp) + '</span></div>' +
      '<div class="comment-text">' + escapeHtml(r.comment) + '</div>' +
    '</div>';
  }

  function renderThread(top, replies) {
    var resolvedBit = top.resolved
      ? '<span class="resolved-badge">&#10003; Resolved</span>'
      : '';
    var resolveBtn = (!top.resolved && replies.length > 0)
      ? '<span class="resolve-wrap" data-id="' + top.id + '">' +
          '<button class="resolve-btn" data-id="' + top.id + '">Mark Resolved</button>' +
        '</span>'
      : '';
    return '<div class="comment-item" data-id="' + top.id + '">' +
      '<div class="comment-meta"><strong>' + escapeHtml(top.name) + '</strong>' +
      '<span class="comment-date">' + fmtDate(top.timestamp) + '</span>' + resolvedBit + '</div>' +
      '<div class="comment-text">' + escapeHtml(top.comment) + '</div>' +
      '<div class="comment-actions">' +
        '<button class="reply-toggle-btn" data-id="' + top.id + '" data-section="' + escapeHtml(top.section) + '">Reply</button>' +
        resolveBtn +
      '</div>' +
      '<div class="reply-form" data-id="' + top.id + '" style="display:none;">' +
        '<input type="text" class="reply-name" placeholder="Your name" maxlength="80">' +
        '<input type="email" class="reply-email" placeholder="Your email (must be approved to comment)" maxlength="120">' +
        '<textarea class="reply-text" placeholder="Write a reply…" rows="2" maxlength="2000"></textarea>' +
        '<div class="comment-form-row">' +
          '<button class="pdf-btn comment-submit-btn reply-submit-btn" data-id="' + top.id + '" data-section="' + escapeHtml(top.section) + '">Post Reply</button>' +
          '<span class="comment-status"></span>' +
        '</div>' +
      '</div>' +
      (replies.length ? '<div class="reply-list">' + replies.map(renderReply).join('') + '</div>' : '') +
    '</div>';
  }

  function renderComments(allComments) {
    var containers = document.querySelectorAll('.comment-thread-list');
    containers.forEach(function (el) {
      var section = el.dataset.section;
      var inSection = allComments.filter(function (c) { return c.section === section; });
      var tops = inSection.filter(function (c) { return !c.parentId; })
        .sort(function (a, b) { return new Date(b.timestamp) - new Date(a.timestamp); });
      if (!tops.length) {
        el.innerHTML = '<p class="section-note">No comments yet — be the first to leave one.</p>';
        return;
      }
      el.innerHTML = tops.map(function (top) {
        var replies = inSection.filter(function (c) { return c.parentId === top.id; })
          .sort(function (a, b) { return new Date(a.timestamp) - new Date(b.timestamp); });
        return renderThread(top, replies);
      }).join('');
    });
    applySavedIdentity();
  }

  function loadAllComments() {
    var containers = document.querySelectorAll('.comment-thread-list');
    if (!containers.length) return;
    apiCall('/api/get-comments', 'GET')
      .then(renderComments)
      .catch(function (err) {
        containers.forEach(function (el) {
          el.innerHTML = '<p class="section-note">Could not load comments: ' + escapeHtml(String(err)) + '</p>';
        });
      });
  }

  // Shows a "not on the approved list" message with a Request Access
  // button inside the given status <span>, reusing the name/email already
  // typed into that form.
  function showNotWhitelisted(statusEl, formEl) {
    statusEl.innerHTML = 'This email isn\\'t approved to comment yet. ' +
      '<button type="button" class="request-access-btn">Request Access</button>';
    var btn = statusEl.querySelector('.request-access-btn');
    btn.addEventListener('click', function () {
      var nameEl = formEl.querySelector('.c-name, .reply-name');
      var emailEl = formEl.querySelector('.c-email, .reply-email');
      var name = nameEl ? nameEl.value : '';
      var email = emailEl ? emailEl.value : '';
      if (!email || email.indexOf('@') === -1) {
        statusEl.textContent = 'Enter a valid email above first, then try again.';
        return;
      }
      btn.disabled = true;
      btn.textContent = 'Sending…';
      apiCall('/api/request-access', 'POST', { name: name, email: email, reason: '' })
        .then(function (res) {
          if (res && res.success) {
            saveIdentity(name, email);
            statusEl.textContent = 'Request sent — you can comment once approved. Your draft is still here.';
          } else if (res && res.error === 'already_whitelisted') {
            statusEl.textContent = 'This email is already approved — try posting again.';
          } else {
            statusEl.textContent = 'Error: ' + ((res && res.error) || 'unknown');
          }
        })
        .catch(function (err) { statusEl.textContent = 'Error: ' + err; });
    });
  }

  // Shared resolve call used by both the one-click path (email already
  // known from a prior comment/reply/resolve on this device) and the
  // inline-form path (first time, nothing saved yet).
  function doResolve(id, email, btnEl, statusEl) {
    var origText = btnEl.textContent;
    btnEl.disabled = true;
    btnEl.textContent = 'Resolving…';
    apiCall('/api/resolve-comment', 'POST', { id: id, email: email })
      .then(function (res) {
        if (res && res.success) {
          saveIdentity('', email);
          loadAllComments();
        } else if (res && res.error === 'not_whitelisted') {
          var msg = 'That email isn\\'t approved yet. Ask an admin to add it to the Whitelist, or use "Request Access" on a comment form.';
          if (statusEl) { statusEl.textContent = msg; } else { alert(msg); }
          btnEl.disabled = false; btnEl.textContent = origText;
        } else {
          var msg2 = 'Error: ' + ((res && res.error) || 'unknown');
          if (statusEl) { statusEl.textContent = msg2; } else { alert(msg2); }
          btnEl.disabled = false; btnEl.textContent = origText;
        }
      })
      .catch(function (err) {
        if (statusEl) { statusEl.textContent = 'Error: ' + err; } else { alert('Error: ' + err); }
        btnEl.disabled = false; btnEl.textContent = origText;
      });
  }

  // Feedback popup — deliberately separate from the comment threads: no
  // whitelist check, no Sheet storage, just an email straight to
  // NOTIFY_EMAILS, so anyone (including viewers who aren't approved to
  // comment) has a frictionless way to send a one-off note.
  function openFeedbackModal() {
    var overlay = document.getElementById('feedback-modal-overlay');
    if (!overlay) return;
    overlay.style.display = 'flex';
    var saved = getSavedIdentity();
    var nameEl = document.getElementById('fb-name');
    var emailEl = document.getElementById('fb-email');
    if (nameEl && !nameEl.value) nameEl.value = saved.name;
    if (emailEl && !emailEl.value) emailEl.value = saved.email;
  }

  function closeFeedbackModal() {
    var overlay = document.getElementById('feedback-modal-overlay');
    if (overlay) overlay.style.display = 'none';
    var statusEl = document.getElementById('fb-status');
    if (statusEl) statusEl.textContent = '';
  }

  function initFeedbackModal() {
    var openBtn = document.getElementById('feedback-open-btn');
    var overlay = document.getElementById('feedback-modal-overlay');
    if (!openBtn || !overlay) return;
    openBtn.addEventListener('click', openFeedbackModal);
    overlay.querySelector('.modal-close-btn').addEventListener('click', closeFeedbackModal);
    overlay.addEventListener('click', function (ev) {
      if (ev.target === overlay) closeFeedbackModal();
    });
    document.getElementById('fb-submit-btn').addEventListener('click', function () {
      var btn = this;
      var name = document.getElementById('fb-name').value;
      var email = document.getElementById('fb-email').value;
      var message = document.getElementById('fb-message').value.trim();
      var statusEl = document.getElementById('fb-status');
      if (!message) { statusEl.textContent = 'Please write a message first.'; return; }
      btn.disabled = true;
      statusEl.textContent = 'Sending…';
      apiCall('/api/submit-feedback', 'POST', { name: name, email: email, message: message })
        .then(function (res) {
          btn.disabled = false;
          if (res && res.success) {
            saveIdentity(name, email);
            document.getElementById('fb-message').value = '';
            statusEl.textContent = 'Sent — thank you!';
            setTimeout(closeFeedbackModal, 1200);
          } else {
            statusEl.textContent = 'Error: ' + ((res && res.error) || 'unknown');
          }
        })
        .catch(function (err) { btn.disabled = false; statusEl.textContent = 'Error: ' + err; });
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    loadAllComments();
    applySavedIdentity();
    initFeedbackModal();

    document.addEventListener('click', function (ev) {
      var target = ev.target;

      // Toggle a reply form open/closed.
      if (target.classList.contains('reply-toggle-btn')) {
        var id = target.dataset.id;
        var form = document.querySelector('.reply-form[data-id="' + id + '"]');
        if (form) form.style.display = (form.style.display === 'none') ? 'flex' : 'none';
        return;
      }

      // Mark a thread resolved. If this browser already has an approved
      // email saved (from a prior comment/reply/resolve), resolve
      // immediately with no prompt. Otherwise, swap the button for a
      // small inline email field instead of an OS-level popup.
      if (target.classList.contains('resolve-btn')) {
        var rid = target.dataset.id;
        var saved = getSavedIdentity();
        if (saved.email) {
          doResolve(rid, saved.email, target, null);
        } else {
          var wrap = target.closest('.resolve-wrap');
          wrap.innerHTML =
            '<input type="email" class="resolve-email-input" placeholder="Your approved email" maxlength="120">' +
            '<button class="resolve-btn resolve-confirm-btn" data-id="' + rid + '">Confirm</button>' +
            '<span class="comment-status resolve-status"></span>';
        }
        return;
      }

      // Confirm resolving from the inline email field shown above.
      if (target.classList.contains('resolve-confirm-btn')) {
        var rid2 = target.dataset.id;
        var wrap2 = target.closest('.resolve-wrap');
        var emailInput = wrap2.querySelector('.resolve-email-input');
        var statusEl3 = wrap2.querySelector('.resolve-status');
        var email3 = emailInput.value.trim();
        if (!email3 || email3.indexOf('@') === -1) { statusEl3.textContent = 'Enter a valid email.'; return; }
        doResolve(rid2, email3, target, statusEl3);
        return;
      }

      // Post a reply.
      if (target.classList.contains('reply-submit-btn')) {
        var pid = target.dataset.id;
        var section = target.dataset.section;
        var form2 = document.querySelector('.reply-form[data-id="' + pid + '"]');
        var name = form2.querySelector('.reply-name').value;
        var email = form2.querySelector('.reply-email').value;
        var text = form2.querySelector('.reply-text').value;
        var statusEl = form2.querySelector('.comment-status');
        if (!text.trim()) { statusEl.textContent = 'Please write a reply first.'; return; }
        if (!email || email.indexOf('@') === -1) { statusEl.textContent = 'Enter your email first.'; return; }
        target.disabled = true;
        statusEl.textContent = 'Posting…';
        apiCall('/api/add-comment', 'POST', { name: name, email: email, section: section, text: text, parentId: pid })
          .then(function (res) {
            target.disabled = false;
            if (res && res.success) {
              saveIdentity(name, email);
              loadAllComments();
            } else if (res && res.error === 'not_whitelisted') {
              showNotWhitelisted(statusEl, form2);
            } else {
              statusEl.textContent = 'Error: ' + ((res && res.error) || 'unknown');
            }
          })
          .catch(function (err) { statusEl.textContent = 'Error: ' + err; target.disabled = false; });
        return;
      }

      // Post a new top-level comment.
      if (target.classList.contains('new-comment-btn')) {
        var section2 = target.dataset.section;
        var block = target.closest('.comments-block');
        var name2 = block.querySelector('.c-name').value;
        var email2 = block.querySelector('.c-email').value;
        var text2 = block.querySelector('.c-text').value;
        var statusEl2 = block.querySelector('.comment-status');
        if (!text2.trim()) { statusEl2.textContent = 'Please write a comment first.'; return; }
        if (!email2 || email2.indexOf('@') === -1) { statusEl2.textContent = 'Enter your email first.'; return; }
        target.disabled = true;
        statusEl2.textContent = 'Posting…';
        apiCall('/api/add-comment', 'POST', { name: name2, email: email2, section: section2, text: text2, parentId: '' })
          .then(function (res) {
            target.disabled = false;
            if (res && res.success) {
              saveIdentity(name2, email2);
              block.querySelector('.c-text').value = '';
              statusEl2.textContent = '';
              loadAllComments();
            } else if (res && res.error === 'not_whitelisted') {
              showNotWhitelisted(statusEl2, block);
            } else {
              statusEl2.textContent = 'Error: ' + ((res && res.error) || 'unknown');
            }
          })
          .catch(function (err) { statusEl2.textContent = 'Error: ' + err; target.disabled = false; });
        return;
      }
    });
  });
</script>"""
html, n = re.subn(r"\n</script>", JS, html, count=1)
assert n == 1, "Could not inject comments JS"

import os
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w", encoding="utf-8") as f:
    f.write(html)

print("Wrote Vercel front-end:", OUT, "size KB:", len(html.encode("utf-8")) / 1024)
