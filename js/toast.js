// ─── Toast notifications ──────────────────────────────────────────────────────
// Single global toast slot. Calling showToast() replaces the message and
// resets the auto-hide timer.
function showToast(msg) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg; // textContent — safe against HTML injection.
  toast.classList.add('visible');
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => toast.classList.remove('visible'), 2200);
}
