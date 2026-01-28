function applyPlaylistSubmenuPrototype(submenu) {
  if (!submenu) {
    return false;
  }

  submenu.style.display = 'block';
  submenu.style.transform = 'translateY(0)';
  submenu.style.opacity = '1';
  submenu.style.zIndex = '200500';
  submenu.style.pointerEvents = 'auto';
  submenu.style.overflow = 'hidden';
  submenu.style.overflowX = 'hidden';
  submenu.style.top = '70px';
  submenu.style.height = 'calc(100vh - 120px)';
  submenu.classList.add('open');

  return true;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { applyPlaylistSubmenuPrototype };
}

if (typeof window !== 'undefined') {
  window.applyPlaylistSubmenuPrototype = applyPlaylistSubmenuPrototype;
}
