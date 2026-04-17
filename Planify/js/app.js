function init() {
  const now    = new Date();
  currentMonth = now.getMonth();
  currentYear  = now.getFullYear();

  applyRemovedPresets();
  loadData();
  buildEmojiPicker();
  render();

  document.getElementById('overlay').addEventListener('click', closeAllSheets);
  document.getElementById('manageCustomBtn').addEventListener('click', toggleManageCustom);
}

document.addEventListener('DOMContentLoaded', init);
