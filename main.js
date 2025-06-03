// Import semua modules
import './src/components.js';
import './src/condition.js';
import './src/routing.js';
import './src/Game/tebakKata.js';

// Import functions yang diperlukan untuk global access
import { showMessage } from './src/components.js';
import { GameMenu, bath, feed, tebakKata } from './src/routing.js';
import { revealHint } from './src/Game/tebakKata.js';

// Buat functions tersedia secara global untuk onclick handlers
window.toGame = GameMenu;
window.bath = bath;
window.feed = feed;
window.tebakKata = tebakKata;
window.revealHint = revealHint;
window.showMessage = showMessage;

console.log('All modules loaded successfully!');