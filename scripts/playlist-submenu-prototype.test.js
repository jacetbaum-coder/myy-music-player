const assert = require('assert');
const { applyPlaylistSubmenuPrototype } = require('./playlist-submenu-prototype');

const nullResult = applyPlaylistSubmenuPrototype(null);
assert.strictEqual(nullResult, false, 'returns false when submenu is missing');

const mockSubmenu = {
  style: {},
  classList: {
    classes: new Set(),
    add(value) {
      this.classes.add(value);
    },
  },
};

const applied = applyPlaylistSubmenuPrototype(mockSubmenu);
assert.strictEqual(applied, true, 'returns true when submenu styles are applied');
assert.strictEqual(mockSubmenu.style.display, 'block');
assert.strictEqual(mockSubmenu.style.transform, 'translateY(0)');
assert.strictEqual(mockSubmenu.style.opacity, '1');
assert.strictEqual(mockSubmenu.style.zIndex, '200500');
assert.strictEqual(mockSubmenu.style.pointerEvents, 'auto');
assert.strictEqual(mockSubmenu.style.overflow, 'hidden');
assert.strictEqual(mockSubmenu.style.overflowX, 'hidden');
assert.strictEqual(mockSubmenu.style.top, '70px');
assert.strictEqual(mockSubmenu.style.height, 'calc(100vh - 120px)');
assert.ok(mockSubmenu.classList.classes.has('open'));

console.log('playlist submenu prototype tests passed');
