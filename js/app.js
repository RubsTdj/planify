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

  // Load data from Supabase (async)
  await loadData();

  hideLoader();
  render();

  document.getElementById('overlay').addEventListener('click', closeAllSheets);
  document.getElementById('manageCustomBtn').addEventListener('click', toggleManageCustom);

  // Swipe down to close on both sheets
  initSwipeToClose(document.getElementById('eventSheet'),  closeSheet);
  initSwipeToClose(document.getElementById('customSheet'), closeCustomSheet);
}

document.addEventListener('DOMContentLoaded', init);
