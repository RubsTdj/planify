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
}

document.addEventListener('DOMContentLoaded', init);
