function showLoader() {
  document.getElementById('appLoader').style.display = 'flex';
}
function hideLoader() {
  document.getElementById('appLoader').style.display = 'none';
}

async function init() {
  const now    = new Date();
  currentMonth = now.getMonth();
  currentYear  = now.getFullYear();

  buildEmojiPicker();

  // Auth gate — shows auth/PIN screens if needed, launches app when ready
  await initAuth();
}

document.addEventListener('DOMContentLoaded', init);

// Prevent double-tap zoom on iOS (CSS touch-action alone is not enough)
let lastTap = 0;
document.addEventListener('touchend', function (e) {
  const now = Date.now();
  if (now - lastTap < 300) {
    e.preventDefault();
  }
  lastTap = now;
}, { passive: false });
