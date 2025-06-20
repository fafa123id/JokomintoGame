// RxJS Event Handler System
// Use globally loaded RxJS
const { fromEvent, merge, map, filter, tap, debounceTime, distinctUntilChanged, catchError, retry, EMPTY } = rxjs;

import { sendEvent } from "./stateManager.js";
import { showMessage, playSoundEffect, showOverlay } from "./components.js";
import { playCondition, feedCondition } from "./condition.js";
import { pageTebakKata } from "./Game/tebakKata.js";
import { pageTebakGambar } from "./Game/tebakGambar.js";
import { showMenuMakanan, buyFood } from "./Menu/foodMenu.js";
import { showMenuSabun, buySabun } from "./Menu/soapMenu.js";
import { eventDebugger } from "./debug.js";

class EventHandler {
  constructor() {
    this.subscriptions = [];
    this.isDestroyed = false;
    this.initializeEventStreams();
  }

  // Global error handler untuk semua streams
  handleError(error, context = 'Unknown') {
    eventDebugger.log('error', context, error.message, error);
    console.error(`❌ EventHandler Error in ${context}:`, error);
    showMessage(`System error occurred. Please try again.`, "error", 2000);
    
    // Return empty observable untuk continue stream
    return EMPTY;
  }

  // Safe subscription dengan error handling
  safeSubscribe(observable$, handler, context = 'Unknown') {
    if (this.isDestroyed) return;
    
    const trackingId = eventDebugger.startPerformanceTracking(`Subscribe_${context}`);
    
    const subscription = observable$.pipe(
      tap(() => eventDebugger.log('info', context, 'Event triggered')),
      catchError(error => this.handleError(error, context)),
      retry(1) // Retry once on error
    ).subscribe({
      next: (data) => {
        try {
          handler(data);
          eventDebugger.endPerformanceTracking(trackingId);
          eventDebugger.log('success', context, 'Event handled successfully');
        } catch (error) {
          eventDebugger.log('error', context, 'Handler execution failed', error);
          this.handleError(error, context);
        }
      },
      error: error => this.handleError(error, context)
    });
    
    this.subscriptions.push(subscription);
    return subscription;
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
    try {
      // Start Game Stream
      const startGameBtn = document.querySelector('[data-action="start-game"]');
      if (startGameBtn) {
        const startGame$ = fromEvent(startGameBtn, 'click').pipe(
          tap(() => console.log('🎮 Start game clicked')),
          map(() => ({ type: 'START' })),
          debounceTime(100) // Prevent double-click
        );
        
        this.safeSubscribe(
          startGame$, 
          () => sendEvent("START"), 
          'StartGame'
        );
      }

      // Home Page Stream dengan safe handling untuk empty NodeList
      const homeButtons = document.querySelectorAll('[data-action="home"]');
      if (homeButtons.length > 0) {
        const homePage$ = merge(
          ...Array.from(homeButtons).map(btn => fromEvent(btn, 'click'))
        ).pipe(
          tap(() => console.log('🏠 Home clicked')),
          map(() => ({ type: 'BACK' })),
          debounceTime(100)
        );
        
        this.safeSubscribe(
          homePage$, 
          () => sendEvent("BACK"), 
          'HomePage'
        );
      }

      // Game Menu Stream dengan validation
      const gameMenuBtn = document.querySelector('[data-action="game-menu"]');
      if (gameMenuBtn) {
        const gameMenu$ = fromEvent(gameMenuBtn, 'click').pipe(
          tap(() => console.log('🎯 Game menu clicked')),
          filter(() => {
            try {
              return playCondition();
            } catch (error) {
              console.error('❌ Play condition check failed:', error);
              return false;
            }
          }),
          map(() => ({ type: 'PLAY' })),
          debounceTime(100)
        );
        
        this.safeSubscribe(
          gameMenu$, 
          () => sendEvent("PLAY"), 
          'GameMenu'
        );
      }
    } catch (error) {
      this.handleError(error, 'NavigationEvents Setup');
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
    try {
      // Soap Menu Stream
      const soapMenuBtn = document.querySelector('[data-action="soap-menu"]');
      if (soapMenuBtn) {
        const soapMenu$ = fromEvent(soapMenuBtn, 'click').pipe(
          tap(() => console.log('🛁 Soap menu clicked')),
          debounceTime(100)
        );
        
        this.safeSubscribe(
          soapMenu$, 
          () => {
            if (typeof window.showMenuSabun === 'function') {
              window.showMenuSabun();
            } else {
              throw new Error('showMenuSabun function not available');
            }
          }, 
          'SoapMenu'
        );
      }

      // Food Menu Stream
      const foodMenuBtn = document.querySelector('[data-action="food-menu"]');
      if (foodMenuBtn) {
        const foodMenu$ = fromEvent(foodMenuBtn, 'click').pipe(
          tap(() => console.log('🍽️ Food menu clicked')),
          debounceTime(100)
        );
        
        this.safeSubscribe(
          foodMenu$, 
          () => {
            if (typeof window.showMenuMakanan === 'function') {
              window.showMenuMakanan();
            } else {
              throw new Error('showMenuMakanan function not available');
            }
          }, 
          'FoodMenu'
        );
      }

      // Optimized Soap Buttons dengan single stream
      const soapButtons = document.querySelectorAll('[data-action="buy-soap"]');
      if (soapButtons.length > 0) {
        const soapPurchases$ = merge(
          ...Array.from(soapButtons).map(btn => 
            fromEvent(btn, 'click').pipe(
              map(event => ({
                type: 'soap',
                soapType: event.target.closest('[data-soap-type]').dataset.soapType,
                button: event.target
              }))
            )
          )
        ).pipe(
          tap(({ soapType }) => console.log(`🧼 Buy soap: ${soapType}`)),
          debounceTime(300),
          filter(({ soapType }) => soapType && typeof window.buySabun === 'function')
        );
        
        this.safeSubscribe(
          soapPurchases$, 
          ({ soapType }) => window.buySabun(soapType), 
          'SoapPurchase'
        );
      }

      // Optimized Food Buttons dengan single stream
      const foodButtons = document.querySelectorAll('[data-action="buy-food"]');
      if (foodButtons.length > 0) {
        const foodPurchases$ = merge(
          ...Array.from(foodButtons).map(btn => 
            fromEvent(btn, 'click').pipe(
              map(event => ({
                type: 'food',
                foodType: event.target.closest('[data-food-type]').dataset.foodType,
                button: event.target
              }))
            )
          )
        ).pipe(
          tap(({ foodType }) => console.log(`🍽️ Buy food: ${foodType}`)),
          debounceTime(300),
          filter(({ foodType }) => foodType && typeof window.buyFood === 'function')
        );
        
        this.safeSubscribe(
          foodPurchases$, 
          ({ foodType }) => window.buyFood(foodType), 
          'FoodPurchase'
        );
      }
    } catch (error) {
      this.handleError(error, 'ShopEvents Setup');
    }
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
          terminal.style.display = 'block';
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

  // Validation helper methods
  validateGameState() {
    try {
      const gameService = window.getGameService && window.getGameService();
      return gameService && gameService.state;
    } catch (error) {
      console.warn('⚠️ Game state validation failed:', error);
      return false;
    }
  }

  validateDOMElement(selector) {
    const element = document.querySelector(selector);
    if (!element) {
      console.warn(`⚠️ DOM element not found: ${selector}`);
      return false;
    }
    return element;
  }

  // Performance monitoring
  logPerformance(context, startTime) {
    const endTime = performance.now();
    const duration = endTime - startTime;
    if (duration > 100) { // Log if operation takes more than 100ms
      console.warn(`⚡ Slow operation detected in ${context}: ${duration.toFixed(2)}ms`);
    }
  }

  // Method to cleanup subscriptions
  destroy() {
    if (this.isDestroyed) return;
    
    this.isDestroyed = true;
    const startTime = performance.now();
    
    this.subscriptions.forEach((sub, index) => {
      try {
        if (sub && typeof sub.unsubscribe === 'function') {
          sub.unsubscribe();
        }
      } catch (error) {
        console.error(`❌ Error unsubscribing subscription ${index}:`, error);
      }
    });
    
    this.subscriptions = [];
    this.logPerformance('EventHandler.destroy', startTime);
    console.log('🧹 Event subscriptions cleaned up');
  }

  // Method to reinitialize after DOM changes
  reinitialize() {
    const startTime = performance.now();
    this.destroy();
    this.isDestroyed = false;
    this.initializeEventStreams();
    this.logPerformance('EventHandler.reinitialize', startTime);
    console.log('🔄 Event handlers reinitialized');
  }
}

// Create global event handler instance
let eventHandler = null;

// Feature detection
function checkBrowserCompatibility() {
  const features = {
    rxjs: typeof window.rxjs !== 'undefined',
    es6: typeof Promise !== 'undefined' && typeof Map !== 'undefined',
    dom: typeof document !== 'undefined' && typeof document.querySelector !== 'undefined',
    performance: typeof performance !== 'undefined' && typeof performance.now !== 'undefined'
  };

  const missingFeatures = Object.entries(features)
    .filter(([key, supported]) => !supported)
    .map(([key]) => key);

  if (missingFeatures.length > 0) {
    console.error('❌ Browser compatibility issues:', missingFeatures);
    showMessage('Your browser may not support all features. Please update your browser.', 'error', 5000);
    return false;
  }

  return true;
}

// Initialize function with safety checks
export function initializeEventHandler() {
  try {
    // Check browser compatibility first
    if (!checkBrowserCompatibility()) {
      return null;
    }

    // Check if DOM is ready
    if (document.readyState === 'loading') {
      console.warn('⚠️ DOM not fully loaded, deferring event handler initialization');
      return null;
    }

    // Cleanup existing handler
    if (eventHandler) {
      eventHandler.destroy();
    }

    // Create new handler
    eventHandler = new EventHandler();
    
    // Validate initialization
    if (!eventHandler || eventHandler.isDestroyed) {
      throw new Error('Failed to initialize event handler');
    }

    console.log('✅ RxJS Event Handler initialized successfully');
    return eventHandler;
    
  } catch (error) {
    console.error('❌ Failed to initialize EventHandler:', error);
    showMessage('Failed to initialize event system. Some features may not work.', 'error', 3000);
    return null;
  }
}

// Export for external use
export { EventHandler }; 