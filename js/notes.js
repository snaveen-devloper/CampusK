'use strict';

let NOTES = [];
let noteTab = 'all';

async function fetchNotes() {
  try {
    const res = await apiFetch('/notes');
    NOTES = res.notes || [];
    renderNotes();
  } catch (e) { console.error('Failed to load notes', e); }
}

function switchNotesTab(tab, el) {
  noteTab = tab;
  document.querySelectorAll('#tab-notes .rtab').forEach(t => t.classList.remove('on'));
  el.classList.add('on');
  renderNotes();
}

function fileTypeIcon(mime = '') {
  if (mime.includes('pdf')) return 'ph-file-pdf';
  if (mime.includes('image')) return 'ph-image';
  if (mime.includes('word') || mime.includes('docx')) return 'ph-file-doc';
  if (mime.includes('presentation') || mime.includes('ppt')) return 'ph-file-ppt';
  if (mime.includes('text')) return 'ph-file-text';
  return 'ph-file';
}

function renderNotes() {
  const el = document.getElementById('notes-list');
  if (!el) return;
  el.innerHTML = '';
  
  // 'all' = public notes + my own notes; 'mine' = only my own notes
  const list = noteTab === 'mine'
    ? NOTES.filter(n => n.author_uid === ME.uid)
    : NOTES.filter(n => n.is_public || n.author_uid === ME.uid);
  
  if (list.length === 0) {
    el.innerHTML = `<div class="empty"><i class="ph ph-notepad" style="font-size:2rem;color:var(--t3)"></i><div>No notes found in this space.</div></div>`;
    return;
  }

  list.forEach(n => {
    const d = document.createElement('div');
    d.className = 'req-card';
    d.style.cursor = 'pointer';
    const date = new Date(n.ts).toLocaleDateString();
    const attachIcon = n.attachment_url ? `<i class="ph ph-paperclip" style="color:var(--bl);font-size:.85rem" title="Has attachment"></i>` : '';
    
    d.innerHTML = `
      ${getAvatarHtml(n.author_uid, n.author_name || 'User', null, 36, .7)}
      <div class="req-body">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div>
            <div class="req-name" style="display:flex;align-items:center;gap:6px">${escHtml(n.title)} ${attachIcon}</div>
            <div class="req-det">By ${n.author_name || 'Unknown'} · ${date}</div>
          </div>
          <div style="display:flex;gap:4px">
            ${n.is_public ? '<span class="pill g">Public</span>' : '<span class="pill m">Private</span>'}
            ${n.forks > 0 ? `<span class="pill b"><i class="ph ph-git-fork"></i> ${n.forks}</span>` : ''}
          </div>
        </div>
      </div>
    `;
    d.onclick = () => openViewNote(n.id);
    el.appendChild(d);
  });
}

function openNewNoteModal() {
  document.getElementById('mnote-id').value = '';
  document.getElementById('mnote-name').value = '';
  document.getElementById('mnote-content').value = '';
  document.getElementById('mnote-public').checked = false;
  document.getElementById('mnote-title').textContent = 'Create New Note';
  // Reset file picker
  const fp = document.getElementById('mnote-file');
  if (fp) fp.value = '';
  const prev = document.getElementById('mnote-file-preview');
  if (prev) { prev.style.display = 'none'; prev.innerHTML = ''; }
  openOvl('modal-note');
}

function previewNoteAttachment(input) {
  const prev = document.getElementById('mnote-file-preview');
  if (!prev) return;
  if (input.files && input.files[0]) {
    const f = input.files[0];
    prev.style.display = 'block';
    prev.innerHTML = `<i class="ph ${fileTypeIcon(f.type)}" style="margin-right:4px"></i><strong>${f.name}</strong> (${(f.size / 1024).toFixed(0)} KB)`;
  } else {
    prev.style.display = 'none';
    prev.innerHTML = '';
  }
}

async function openViewNote(id) {
  const n = NOTES.find(x => x.id === id);
  if (!n) return;

  document.getElementById('vnote-title').textContent = n.title;
  document.getElementById('vnote-meta').textContent = `By ${n.author_name} · Created ${new Date(n.ts).toLocaleDateString()}`;
  document.getElementById('vnote-content').textContent = n.content;

  // Show attachment if any
  const attachEl = document.getElementById('vnote-attachment');
  if (n.attachment_url && attachEl) {
    const isImg = /\.(jpg|jpeg|png|gif|webp)$/i.test(n.attachment_url);
    const isPdf = /\.pdf$/i.test(n.attachment_url);
    attachEl.style.display = 'block';
    if (isImg) {
      attachEl.innerHTML = `
        <div style="font-size:.75rem;color:var(--t3);margin-bottom:6px"><i class="ph ph-paperclip"></i> Attachment</div>
        <img src="${n.attachment_url}" alt="Attachment" style="max-width:100%;border-radius:var(--r2);max-height:300px;object-fit:contain">
        <div style="margin-top:8px"><a href="${n.attachment_url}" target="_blank" class="btn-sm b" style="display:inline-flex;align-items:center;gap:4px"><i class="ph ph-download-simple"></i> Download</a></div>
      `;
    } else {
      attachEl.innerHTML = `
        <div style="font-size:.75rem;color:var(--t3);margin-bottom:8px"><i class="ph ph-paperclip"></i> Attachment</div>
        <div style="display:flex;align-items:center;gap:10px;padding:.75rem;background:var(--s2);border-radius:var(--r2)">
          <i class="ph ${fileTypeIcon(n.attachment_mime || '')} ph-fill" style="font-size:2rem;color:var(--bl)"></i>
          <div>
            <div style="font-weight:600;font-size:.9rem">${n.attachment_name || 'Attachment'}</div>
            <div style="font-size:.72rem;color:var(--t3)">${n.attachment_mime || ''}</div>
          </div>
          <a href="${n.attachment_url}" target="_blank" class="btn-sm b" style="margin-left:auto;display:inline-flex;align-items:center;gap:4px"><i class="ph ph-download-simple"></i> Download</a>
        </div>
      `;
    }
  } else if (attachEl) {
    attachEl.style.display = 'none';
  }

  const acts = document.getElementById('vnote-acts');
  acts.innerHTML = '';

  if (n.author_uid === ME.uid) {
    const editBtn = document.createElement('button');
    editBtn.className = 'btn-sm p';
    editBtn.innerHTML = '<i class="ph ph-pencil"></i> Edit';
    editBtn.onclick = () => { closeOvl('modal-view-note'); openEditNote(n); };
    acts.appendChild(editBtn);

    const delBtn = document.createElement('button');
    delBtn.className = 'btn-sm d';
    delBtn.innerHTML = '<i class="ph ph-trash"></i> Delete';
    delBtn.onclick = () => deleteNote(n.id);
    acts.appendChild(delBtn);
  } else {
    const forkBtn = document.createElement('button');
    forkBtn.className = 'btn-sm b';
    forkBtn.innerHTML = '<i class="ph ph-git-fork"></i> Fork';
    forkBtn.onclick = () => forkNote(n.id);
    acts.appendChild(forkBtn);
  }

  openOvl('modal-view-note');
}

function openEditNote(n) {
  document.getElementById('mnote-id').value = n.id;
  document.getElementById('mnote-name').value = n.title;
  document.getElementById('mnote-content').value = n.content;
  document.getElementById('mnote-public').checked = !!n.is_public;
  document.getElementById('mnote-title').textContent = 'Edit Note';
  // Reset file picker
  const fp = document.getElementById('mnote-file');
  if (fp) fp.value = '';
  const prev = document.getElementById('mnote-file-preview');
  if (prev) prev.style.display = 'none';
  openOvl('modal-note');
}

async function saveNote() {
  const btn = document.getElementById('save-note-btn');
  const id = document.getElementById('mnote-id').value;
  const title = document.getElementById('mnote-name').value.trim();
  const content = document.getElementById('mnote-content').value;
  const is_public = document.getElementById('mnote-public').checked ? 1 : 0;
  const fileInput = document.getElementById('mnote-file');

  if (!title) return toast('Please enter a title', 'er');

  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Saving...'; }

  try {
    let attachment_url = null, attachment_name = null, attachment_mime = null;

    // Upload file first if selected
    if (fileInput && fileInput.files && fileInput.files[0]) {
      const file = fileInput.files[0];
      // 10MB max
      if (file.size > 10 * 1024 * 1024) { toast('File is too large (max 10 MB).', 'er'); return; }
      const formData = new FormData();
      formData.append('file', file);
      const resp = await fetch(API + '/files/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}` },
        body: formData
      });
      if (!resp.ok) throw new Error('File upload failed');
      const fileData = await resp.json();
      attachment_url = fileData.file.url;
      attachment_name = fileData.file.original_name;
      attachment_mime = fileData.file.mime;
    }

    const body = { title, content, is_public };
    if (attachment_url) {
      body.attachment_url = attachment_url;
      body.attachment_name = attachment_name;
      body.attachment_mime = attachment_mime;
    }

    if (id) {
      await apiFetch(`/notes/${id}`, { method: 'PATCH', body });
      toast('Note updated', 'ok');
    } else {
      await apiFetch('/notes', { method: 'POST', body });
      toast('Note created', 'ok');
    }
    closeOvl('modal-note');
    fetchNotes();
  } catch (e) {
    toast('Failed to save note: ' + e.message, 'er');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ph ph-floppy-disk"></i> Save Note'; }
  }
}

async function forkNote(id) {
  try {
    await apiFetch(`/notes/${id}/fork`, { method: 'POST' });
    toast('Note forked to your collection!', 'ok');
    closeOvl('modal-view-note');
    fetchNotes();
  } catch (e) { toast('Failed to fork note', 'er'); }
}

async function deleteNote(id) {
  if (!confirm('Are you sure you want to delete this note?')) return;
  try {
    await apiFetch(`/notes/${id}`, { method: 'DELETE' });
    toast('Note deleted', 'ok');
    closeOvl('modal-view-note');
    fetchNotes();
  } catch (e) { toast('Failed to delete note', 'er'); }
}
