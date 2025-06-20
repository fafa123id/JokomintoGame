// Debug utility untuk monitoring event system performance
class EventDebugger {
  constructor() {
    this.isDevelopment = this.checkDevelopmentMode();
    this.eventLog = [];
    this.performanceMetrics = new Map();
    this.maxLogSize = 1000; // Limit log size for memory
  }

  checkDevelopmentMode() {
    // Check various indicators for development mode
    return (
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1' ||
      window.location.port !== '' ||
      localStorage.getItem('debug') === 'true'
    );
  }

  log(level, context, message, data = null) {
    if (!this.isDevelopment) return;

    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      context,
      message,
      data,
      id: this.generateId()
    };

    this.eventLog.push(logEntry);
    
    // Trim log if too large
    if (this.eventLog.length > this.maxLogSize) {
      this.eventLog = this.eventLog.slice(-this.maxLogSize);
    }

    // Console output with emoji
    const emoji = {
      info: 'ℹ️',
      warn: '⚠️',
      error: '❌',
      success: '✅',
      performance: '⚡'
    }[level] || 'ℹ️';

    console.log(`${emoji} [${context}] ${message}`, data || '');
  }

  generateId() {
    return Math.random().toString(36).substr(2, 9);
  }

  startPerformanceTracking(context) {
    if (!this.isDevelopment) return null;
    
    const trackingId = this.generateId();
    this.performanceMetrics.set(trackingId, {
      context,
      startTime: performance.now(),
      startMemory: this.getMemoryUsage()
    });
    
    return trackingId;
  }

  endPerformanceTracking(trackingId) {
    if (!this.isDevelopment || !trackingId) return;
    
    const metrics = this.performanceMetrics.get(trackingId);
    if (!metrics) return;

    const endTime = performance.now();
    const endMemory = this.getMemoryUsage();
    
    const duration = endTime - metrics.startTime;
    const memoryDelta = endMemory - metrics.startMemory;

    this.log('performance', metrics.context, 
      `Execution time: ${duration.toFixed(2)}ms, Memory delta: ${memoryDelta.toFixed(2)}MB`
    );

    // Warn if performance is poor
    if (duration > 100) {
      this.log('warn', metrics.context, `Slow operation detected: ${duration.toFixed(2)}ms`);
    }

    this.performanceMetrics.delete(trackingId);
  }

  getMemoryUsage() {
    if (performance.memory) {
      return performance.memory.usedJSHeapSize / 1024 / 1024; // Convert to MB
    }
    return 0;
  }

  getEventStats() {
    if (!this.isDevelopment) return null;

    const stats = {
      totalEvents: this.eventLog.length,
      eventsByLevel: {},
      eventsByContext: {},
      recentEvents: this.eventLog.slice(-10),
      memoryUsage: this.getMemoryUsage(),
      activeTracking: this.performanceMetrics.size
    };

    // Count by level
    this.eventLog.forEach(log => {
      stats.eventsByLevel[log.level] = (stats.eventsByLevel[log.level] || 0) + 1;
      stats.eventsByContext[log.context] = (stats.eventsByContext[log.context] || 0) + 1;
    });

    return stats;
  }

  exportLogs() {
    if (!this.isDevelopment) return null;
    
    const exportData = {
      logs: this.eventLog,
      stats: this.getEventStats(),
      exportTime: new Date().toISOString(),
      userAgent: navigator.userAgent
    };

    return JSON.stringify(exportData, null, 2);
  }

  clearLogs() {
    if (!this.isDevelopment) return;
    
    this.eventLog = [];
    this.performanceMetrics.clear();
    this.log('info', 'Debugger', 'Logs cleared');
  }

  // Visual debug panel integration
  updateDebugPanel() {
    if (!this.isDevelopment) return;
    
    const debugContent = document.getElementById('debugContent');
    if (!debugContent) return;

    const stats = this.getEventStats();
    if (!stats) return;

    debugContent.innerHTML = `
      <div style="text-align: left; font-size: 12px; color: #00ff00;">
        <div><strong>📊 Event System Stats</strong></div>
        <div>Total Events: ${stats.totalEvents}</div>
        <div>Memory Usage: ${stats.memoryUsage.toFixed(2)} MB</div>
        <div>Active Tracking: ${stats.activeTracking}</div>
        <br/>
        <div><strong>📈 Events by Level:</strong></div>
        ${Object.entries(stats.eventsByLevel).map(([level, count]) => 
          `<div>${level}: ${count}</div>`
        ).join('')}
        <br/>
        <div><strong>🔄 Recent Events:</strong></div>
        ${stats.recentEvents.slice(-5).map(log => 
          `<div style="font-size: 10px; opacity: 0.8;">[${log.level}] ${log.context}: ${log.message}</div>`
        ).join('')}
      </div>
    `;
  }

  // Add keyboard shortcuts for debug
  initKeyboardShortcuts() {
    if (!this.isDevelopment) return;

    document.addEventListener('keydown', (e) => {
      // Ctrl+Shift+D - Toggle debug panel
      if (e.ctrlKey && e.shiftKey && e.key === 'D') {
        e.preventDefault();
        const debugToggle = document.getElementById('debugToggle');
        if (debugToggle) debugToggle.click();
      }

      // Ctrl+Shift+C - Clear debug logs
      if (e.ctrlKey && e.shiftKey && e.key === 'C') {
        e.preventDefault();
        this.clearLogs();
      }

      // Ctrl+Shift+E - Export logs
      if (e.ctrlKey && e.shiftKey && e.key === 'E') {
        e.preventDefault();
        const logs = this.exportLogs();
        if (logs) {
          navigator.clipboard.writeText(logs).then(() => {
            this.log('success', 'Debugger', 'Logs exported to clipboard');
          });
        }
      }
    });

    this.log('info', 'Debugger', 'Keyboard shortcuts initialized (Ctrl+Shift+D/C/E)');
  }
}

// Create global debug instance
const eventDebugger = new EventDebugger();

// Update debug panel every 2 seconds in development mode
if (eventDebugger.isDevelopment) {
  setInterval(() => {
    eventDebugger.updateDebugPanel();
  }, 2000);
  
  // Initialize keyboard shortcuts
  eventDebugger.initKeyboardShortcuts();
}

// Export for use in other modules
export { eventDebugger };

// Expose to window for console access
if (eventDebugger.isDevelopment) {
  window.eventDebugger = eventDebugger;
} 