// ─── App entry point ──────────────────────────────────────────────────────────
// Sets the visible month to "today", builds the emoji picker, then hands off
// to the auth flow which eventually calls launchApp().

function showLoader() { document.getElementById('appLoader').style.display = 'flex'; }
function hideLoader() { document.getElementById('appLoader').style.display = 'none'; }

async function init() {
  const now    = new Date();
  currentMonth = now.getMonth();
  currentYear  = now.getFullYear();

  await initAuth();
}

document.addEventListener('DOMContentLoaded', init);

// Block iOS double-tap zoom (CSS `touch-action: manipulation` alone leaves a
// 300ms delay that some users perceive as laggy when chaining taps).
let lastTap = 0;
document.addEventListener('touchend', function (e) {
  const now = Date.now();
  if (now - lastTap < 300) e.preventDefault();
  lastTap = now;
}, { passive: false });
