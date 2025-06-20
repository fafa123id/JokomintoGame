// RxJS Event Handler System
// Use globally loaded RxJS
const { fromEvent, merge, map, filter, tap, debounceTime, distinctUntilChanged } = rxjs;

import { sendEvent } from "./stateManager.js";
import { showMessage, playSoundEffect, showOverlay } from "./components.js";
import { playCondition, feedCondition } from "./condition.js";
import { pageTebakKata } from "./Game/tebakKata.js";
import { pageTebakGambar } from "./Game/tebakGambar.js";
import { showMenuMakanan, buyFood } from "./Menu/foodMenu.js";
import { showMenuSabun, buySabun } from "./Menu/soapMenu.js";

class EventHandler {
  constructor() {
    this.subscriptions = [];
    this.initializeEventStreams();
  }

  initializeEventStreams() {
    // Navigation Events Stream
    this.setupNavigationEvents();
    
    // Game Events Stream
    this.setupGameEvents();
    
    // Shop Events Stream
    this.setupShopEvents();
    
    // Form Events Stream
    this.setupFormEvents();
    
    // Utility Events Stream
    this.setupUtilityEvents();
  }

  setupNavigationEvents() {
    // Start Game Stream
    const startGameBtn = document.querySelector('[data-action="start-game"]');
    if (startGameBtn) {
      const startGame$ = fromEvent(startGameBtn, 'click').pipe(
        tap(() => console.log('🎮 Start game clicked')),
        map(() => ({ type: 'START' }))
      );
      
      this.subscriptions.push(
        startGame$.subscribe(() => sendEvent("START"))
      );
    }

    // Home Page Stream
    const homeButtons = document.querySelectorAll('[data-action="home"]');
    const homePage$ = merge(
      ...Array.from(homeButtons).map(btn => fromEvent(btn, 'click'))
    ).pipe(
      tap(() => console.log('🏠 Home clicked')),
      map(() => ({ type: 'BACK' }))
    );
    
    this.subscriptions.push(
      homePage$.subscribe(() => sendEvent("BACK"))
    );

    // Game Menu Stream
    const gameMenuBtn = document.querySelector('[data-action="game-menu"]');
    if (gameMenuBtn) {
      const gameMenu$ = fromEvent(gameMenuBtn, 'click').pipe(
        tap(() => console.log('🎯 Game menu clicked')),
        filter(() => playCondition()),
        map(() => ({ type: 'PLAY' }))
      );
      
      this.subscriptions.push(
        gameMenu$.subscribe(() => sendEvent("PLAY"))
      );
    }
  }

  setupGameEvents() {
    // Tebak Kata Stream
    const tebakKataBtn = document.querySelector('[data-action="tebak-kata"]');
    if (tebakKataBtn) {
      const tebakKata$ = fromEvent(tebakKataBtn, 'click').pipe(
        tap(() => console.log('🔤 Tebak kata clicked')),
        filter(() => playCondition())
      );
      
      this.subscriptions.push(
        tebakKata$.subscribe(() => {
          window.pageTebakKata();
        })
      );
    }

    // Tebak Gambar Stream
    const tebakGambarBtn = document.querySelector('[data-action="tebak-gambar"]');
    if (tebakGambarBtn) {
      const tebakGambar$ = fromEvent(tebakGambarBtn, 'click').pipe(
        tap(() => console.log('🖼️ Tebak gambar clicked')),
        filter(() => playCondition())
      );
      
      this.subscriptions.push(
        tebakGambar$.subscribe(() => {
          pageTebakGambar();
        })
      );
    }

    // Hint Stream (with debounce to prevent spam)
    const hintBtn = document.querySelector('[data-action="reveal-hint"]');
    if (hintBtn) {
      const hint$ = fromEvent(hintBtn, 'click').pipe(
        debounceTime(500), // Prevent spam clicking
        tap(() => console.log('💡 Hint requested'))
      );
      
      this.subscriptions.push(
        hint$.subscribe(() => {
          const currentCoin = parseInt(localStorage.getItem("coin")) || 0;
          if (currentCoin >= 20) {
            // Call original hint function
            window.revealHint && window.revealHint();
          } else {
            showMessage("Insufficient coin for hint!", "error", 2000);
          }
        })
      );
    }

    // Image Tile Reveal Stream
    const imageTileBtn = document.querySelector('[data-action="reveal-tile"]');
    if (imageTileBtn) {
      const imageTile$ = fromEvent(imageTileBtn, 'click').pipe(
        debounceTime(500),
        tap(() => console.log('🔍 Image tile reveal requested'))
      );
      
      this.subscriptions.push(
        imageTile$.subscribe(() => {
          const currentCoin = parseInt(localStorage.getItem("coin")) || 0;
          if (currentCoin >= 20) {
            window.revealImageTile && window.revealImageTile();
          } else {
            showMessage("Insufficient coin for tile reveal!", "error", 2000);
          }
        })
      );
    }
  }

  setupShopEvents() {
    // Soap Menu Stream
    const soapMenuBtn = document.querySelector('[data-action="soap-menu"]');
    if (soapMenuBtn) {
      const soapMenu$ = fromEvent(soapMenuBtn, 'click').pipe(
        tap(() => console.log('🛁 Soap menu clicked'))
      );
      
      this.subscriptions.push(
        soapMenu$.subscribe(() => window.showMenuSabun())
      );
    }

    // Food Menu Stream
    const foodMenuBtn = document.querySelector('[data-action="food-menu"]');
    if (foodMenuBtn) {
      const foodMenu$ = fromEvent(foodMenuBtn, 'click').pipe(
        tap(() => console.log('🍽️ Food menu clicked'))
      );
      
      this.subscriptions.push(
        foodMenu$.subscribe(() => window.showMenuMakanan())
      );
    }

    // Buy Soap Stream
    const soapButtons = document.querySelectorAll('[data-action="buy-soap"]');
    soapButtons.forEach(btn => {
      const soapType = btn.dataset.soapType;
      const buySoap$ = fromEvent(btn, 'click').pipe(
        tap(() => console.log(`🧼 Buy soap: ${soapType}`)),
        debounceTime(300) // Prevent double-click purchases
      );
      
      this.subscriptions.push(
        buySoap$.subscribe(() => window.buySabun(soapType))
      );
    });

    // Buy Food Stream
    const foodButtons = document.querySelectorAll('[data-action="buy-food"]');
    foodButtons.forEach(btn => {
      const foodType = btn.dataset.foodType;
      const buyFood$ = fromEvent(btn, 'click').pipe(
        tap(() => console.log(`🍽️ Buy food: ${foodType}`)),
        debounceTime(300) // Prevent double-click purchases
      );
      
      this.subscriptions.push(
        buyFood$.subscribe(() => window.buyFood(foodType))
      );
    });
  }

  setupFormEvents() {
    // Tebak Kata Form Stream
    const tebakKataForm = document.getElementById('tebakKataForm');
    if (tebakKataForm) {
      const tebakKataSubmit$ = fromEvent(tebakKataForm, 'submit').pipe(
        tap(e => e.preventDefault()),
        map(e => e.target.querySelector('#inputTebakKata').value),
        filter(value => value.trim().length > 0),
        distinctUntilChanged(),
        tap(value => console.log(`🔤 Submit guess: ${value}`))
      );
      
      this.subscriptions.push(
        tebakKataSubmit$.subscribe(value => {
          window.tebakKataSubmit && window.tebakKataSubmit();
        })
      );
    }

    // Tebak Gambar Form Stream
    const tebakGambarForm = document.getElementById('tebakGambarForm');
    if (tebakGambarForm) {
      const tebakGambarSubmit$ = fromEvent(tebakGambarForm, 'submit').pipe(
        tap(e => e.preventDefault()),
        map(e => e.target.querySelector('#inputTebakGambar').value),
        filter(value => value.trim().length > 0),
        distinctUntilChanged(),
        tap(value => console.log(`🖼️ Submit guess: ${value}`))
      );
      
      this.subscriptions.push(
        tebakGambarSubmit$.subscribe(value => {
          window.submitImageGuess && window.submitImageGuess();
        })
      );
    }
  }

  setupUtilityEvents() {
    // Wake Up Stream
    const wakeUpBtn = document.querySelector('[data-action="wake-up"]');
    if (wakeUpBtn) {
      const wakeUp$ = fromEvent(wakeUpBtn, 'click').pipe(
        tap(() => console.log('☀️ Wake up clicked'))
      );
      
      this.subscriptions.push(
        wakeUp$.subscribe(() => {
          window.wakeUp && window.wakeUp();
        })
      );
    }

    // Debug Terminal Events
    this.setupDebugEvents();
  }

  setupDebugEvents() {
    const debugToggle = document.getElementById('debugToggle');
    const clearDebug = document.getElementById('clearDebug');
    const closeDebug = document.getElementById('closeDebug');

    if (debugToggle) {
      const debugToggle$ = fromEvent(debugToggle, 'click').pipe(
        tap(() => console.log('🐛 Debug toggle'))
      );
      
      this.subscriptions.push(
        debugToggle$.subscribe(() => {
          const terminal = document.getElementById('debugTerminal');
          const isVisible = terminal.style.display !== 'none';
          terminal.style.display = isVisible ? 'none' : 'block';
        })
      );
    }

    if (clearDebug) {
      const clearDebug$ = fromEvent(clearDebug, 'click').pipe(
        tap(() => console.log('🗑️ Clear debug'))
      );
      
      this.subscriptions.push(
        clearDebug$.subscribe(() => {
          document.getElementById('debugContent').innerHTML = '';
        })
      );
    }

    if (closeDebug) {
      const closeDebug$ = fromEvent(closeDebug, 'click').pipe(
        tap(() => console.log('❌ Close debug'))
      );
      
      this.subscriptions.push(
        closeDebug$.subscribe(() => {
          document.getElementById('debugTerminal').style.display = 'none';
        })
      );
    }
  }

  // Method to cleanup subscriptions
  destroy() {
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.subscriptions = [];
    console.log('🧹 Event subscriptions cleaned up');
  }

  // Method to reinitialize after DOM changes
  reinitialize() {
    this.destroy();
    this.initializeEventStreams();
    console.log('🔄 Event handlers reinitialized');
  }
}

// Create global event handler instance
let eventHandler = null;

// Initialize function
export function initializeEventHandler() {
  if (eventHandler) {
    eventHandler.destroy();
  }
  eventHandler = new EventHandler();
  console.log('✅ RxJS Event Handler initialized');
  return eventHandler;
}

// Export for external use
export { EventHandler }; 