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

  showLoader();
  buildEmojiPicker();

  // Load data + ensure loader shows for at least 2s to enjoy the animation
  const [_] = await Promise.all([
    loadData(),
    new Promise(r => setTimeout(r, 4000)),
  ]);

  hideLoader();
  render();

  document.getElementById('overlay').addEventListener('click', closeAllSheets);
  document.getElementById('manageCustomBtn').addEventListener('click', toggleManageCustom);

  // Swipe down to close on both sheets
  initSwipeToClose(document.getElementById('eventSheet'),  closeSheet);
  initSwipeToClose(document.getElementById('customSheet'), closeCustomSheet);
}

document.addEventListener('DOMContentLoaded', init);
