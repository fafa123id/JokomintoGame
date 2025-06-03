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
showMessage();
GameMenu();
bath();
feed();
tebakKata();
revealHint();

console.log('All modules loaded successfully!');