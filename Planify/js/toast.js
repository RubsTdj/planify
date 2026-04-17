function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('visible');
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => toast.classList.remove('visible'), 2200);
}
