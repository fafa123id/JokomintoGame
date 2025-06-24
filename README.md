# 🎮 JokomintoGame - Virtual Pet Adventure

![JokomintoGame Banner](https://img.shields.io/badge/JokomintoGame-Virtual%20Pet-purple?style=for-the-badge&logo=gamepad)
![Version](https://img.shields.io/badge/version-2.0.0-blue?style=for-the-badge)
![License](https://img.shields.io/badge/license-MIT-green?style=for-the-badge)

> **Take care of your virtual pet Jokominto and have fun with interactive games!**

Sebuah aplikasi virtual pet yang modern dan interaktif di mana kamu bisa merawat karakter Jokominto dengan berbagai aktivitas seperti bermain game, mandi, dan memberi makan. Dilengkapi dengan sistem state management yang robust dan user interface yang memukau!

## ✨ Features

### 🎯 **Core Gameplay**
- **Virtual Pet Care**: Rawat Jokominto dengan menjaga mood, hygiene, dan hunger levels
- **Interactive Games**: 
  - 🔤 **Tebak Kata** - Guess the word based on clues
  - 🖼️ **Tebak Gambar** - Guess the image from revealed tiles
- **Shopping System**: Beli makanan dan sabun dengan coin yang didapat dari games
- **Status Management**: Real-time monitoring pet conditions dengan visual indicators

### 🎨 **Modern UI/UX**
- **Glassmorphism Design**: Modern blur effects dengan depth layering
- **Animated Gradients**: Dynamic background dengan floating elements
- **Premium Buttons**: Shimmer effects dan 3D transforms
- **Responsive Layout**: Optimized untuk desktop dan mobile devices
- **Loading Animations**: Enhanced spinner dengan typewriter effects

### ⚡ **Technical Features**
- **Reactive Programming**: RxJS streams untuk event handling
- **State Management**: XState finite state machine
- **Error Handling**: Comprehensive error boundaries
- **Performance Monitoring**: Real-time debug system
- **Browser Compatibility**: Modern browser support dengan fallbacks

## 🛠️ Tech Stack

### **Frontend**
- **HTML5** - Semantic markup structure
- **CSS3** - Advanced styling dengan CSS Grid/Flexbox
- **Vanilla JavaScript (ES6+)** - Modern JavaScript features
- **TailwindCSS** - Utility-first CSS framework

### **Libraries & Framework**
- **RxJS 7** - Reactive programming untuk event streams
- **XState 4** - State machine untuk business logic management
- **Web Audio API** - Sound effects system

### **Architecture Pattern**
- **Reactive Architecture** - Event-driven dengan observables
- **State Machine Pattern** - Predictable state transitions
- **Module Pattern** - Clean separation of concerns
- **Observer Pattern** - Real-time UI updates

## 🚀 Installation & Setup

### **Prerequisites**
- Modern web browser (Chrome 80+, Firefox 75+, Safari 13+)
- Local web server (recommended)

### **Quick Start**

1. **Clone Repository**
```bash
git clone https://github.com/yourusername/JokomintoGame.git
cd JokomintoGame
```

2. **Install Dependencies** (Optional - untuk development)
```bash
npm install
```

3. **Run Application**
```bash
# Option 1: Simple HTTP Server
python -m http.server 8000

# Option 2: Node.js server
npx http-server

# Option 3: VS Code Live Server
# Install Live Server extension dan klik "Go Live"
```

4. **Access Game**
```
http://localhost:8000
```

## 🎮 How to Play

### **Getting Started**
1. **Launch Game** - Klik tombol "Start" di homepage
2. **Check Status** - Monitor mood, hygiene, hunger, dan coin di status bar
3. **Choose Activity** - Pilih antara Play Game, Bath, atau Eat

### **Game Modes**

#### 🔤 **Tebak Kata (Word Guessing)**
- Tebak kata berdasarkan clue yang diberikan
- **Timer**: 5 detik untuk menjawab
- **Hint**: Kostum 20 coin untuk petunjuk tambahan
- **Reward**: Dapatkan coin jika berhasil

#### 🖼️ **Tebak Gambar (Image Guessing)**
- Tebak gambar dari tile yang terbuka
- **Timer**: 30 detik untuk menjawab
- **Tile Reveal**: Buka tile tambahan dengan 20 coin
- **Strategy**: Gunakan coin dengan bijak untuk membuka tile

### **Pet Care System**

#### 🛁 **Bathing (Hygiene)**
- **Normal Soap** - Free, +30 hygiene
- **Fragrance Soap** - 25 coin, +50 hygiene
- **Premium Soap** - 50 coin, +80 hygiene

#### 🍽️ **Feeding (Hunger)**
- **Cookies** - Free, -10 hunger
- **Bread** - 5 coin, -25 hunger
- **Nasi Goreng** - 15 coin, -40 hunger
- **Pizza** - 30 coin, -60 hunger
- **Premium Steak** - 60 coin, -80 hunger

### **Status Indicators**
- **Mood** 😊 - Affected by overall pet condition
- **Hygiene** 🛁 - Decreases over time, clean with soap
- **Hunger** 🍎 - Increases over time, feed with food
- **Coin** 🪙 - Earned from games, spent on items

## 🏗️ Project Structure

```
JokomintoGame/
├── 📁 asset/                    # Game assets
│   ├── 📁 char/                 # Character sprites
│   ├── 📁 gif/                  # Animation files  
│   ├── 📁 images/               # Game images
│   ├── 📁 soundEffect/          # Audio files
│   └── gameImages.json          # Image data
├── 📁 src/                      # Source code
│   ├── 📁 Game/                 # Game modules
│   │   ├── contextHandler.js    # Game context management
│   │   ├── tebakGambar.js      # Image guessing game
│   │   └── tebakKata.js        # Word guessing game
│   ├── 📁 Menu/                 # Menu systems
│   │   ├── foodMenu.js         # Food shopping
│   │   └── soapMenu.js         # Soap shopping
│   ├── components.js           # UI components
│   ├── condition.js            # Game conditions
│   ├── debug.js               # Debug system
│   ├── eventHandler.js        # RxJS event streams
│   ├── routing.js             # Page routing
│   ├── stateMachine.js        # XState machine
│   └── stateManager.js        # State management
├── index.html                 # Main HTML
├── index.js                   # App entry point
└── package.json              # Dependencies
```

## 🔧 Architecture Overview

### **Event Flow Architecture**
```
User Interaction → RxJS Streams → XState Machine → UI Updates
```

#### **RxJS Event Layer**
```javascript
// Event capture & transformation
const gameMenu$ = fromEvent(gameMenuBtn, 'click').pipe(
  tap(() => console.log('🎯 Game menu clicked')),
  filter(() => playCondition()),
  debounceTime(100)
);
```

#### **XState Business Logic**
```javascript
// State management & transitions  
const machine = createMachine({
  initial: 'home',
  states: {
    home: { on: { START: 'idle' } },
    idle: { on: { PLAY: 'selectGame' } },
    // ... other states
  }
});
```

### **Component System**
- **Modular Design** - Each feature dalam separate modules
- **Reactive Updates** - Real-time UI synchronization
- **Error Boundaries** - Graceful error handling
- **Performance Monitoring** - Built-in debugging tools

## 🎯 Development Guidelines

### **Code Style**
- **ES6+ Features** - Arrow functions, destructuring, modules
- **Functional Programming** - Pure functions when possible
- **Reactive Patterns** - Observable streams untuk data flow
- **Clean Architecture** - Separation of concerns

### **State Management Rules**
1. **RxJS**: Handle events, UI interactions, data streams
2. **XState**: Manage business logic, game rules, state transitions
3. **DOM**: Pure presentation layer dengan reactive updates

### **Performance Best Practices**
- **Debounced Events** - Prevent spam clicking
- **Lazy Loading** - Load assets on demand
- **Memory Management** - Proper cleanup subscriptions
- **Error Recovery** - Retry mechanisms untuk failed operations

## 🎨 UI/UX Features

### **Modern Design Elements**
- **Glassmorphism Cards** - blur effects dengan transparency
- **Animated Gradients** - Dynamic background animations
- **Floating Particles** - Ambient UI enhancements
- **Responsive Typography** - Adaptive text sizing

### **Interactive Animations**
- **Button Hover Effects** - 3D transforms dengan shimmer
- **Character Animations** - Floating dengan particle effects
- **Progress Bars** - Animated fills dengan glow effects
- **Loading Screens** - Multi-ring spinners dengan typewriter

### **Mobile Optimization**
- **Touch-friendly** - Large tap targets (min 48px)
- **Responsive Grid** - Adaptive layouts
- **Performance** - Optimized animations untuk mobile
- **Accessibility** - ARIA labels dan keyboard navigation

## 🐛 Debug System

### **Built-in Developer Tools**
- **Real-time Logging** - Event tracking dengan timestamps
- **Performance Monitoring** - Memory usage dan execution time
- **Error Tracking** - Comprehensive error reporting
- **State Visualization** - Current state machine status

### **Debug Commands**
```javascript
// Toggle debug terminal
Ctrl + Shift + D

// Clear debug logs  
Ctrl + Shift + C

// Export logs
Ctrl + Shift + E
```

## 🚀 Future Enhancements

### **Planned Features**
- [ ] **Multiplayer Mode** - Connect with friends
- [ ] **Achievement System** - Unlock rewards
- [ ] **Pet Customization** - Character skins & accessories
- [ ] **Daily Challenges** - Special events & rewards
- [ ] **Save/Load System** - Cloud sync support

### **Technical Improvements**
- [ ] **PWA Support** - Offline functionality
- [ ] **WebGL Graphics** - Enhanced visual effects
- [ ] **Voice Commands** - Speech recognition
- [ ] **AI Companion** - Smart pet behavior

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

### **Development Setup**
1. Fork the repository
2. Create feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 👨‍💻 Author

**[Your Name]**
- GitHub: [@yourusername](https://github.com/yourusername)
- Email: your.email@example.com

## 🙏 Acknowledgments

- **RxJS Team** - For reactive programming excellence
- **XState Team** - For state machine awesomeness
- **TailwindCSS** - For utility-first CSS framework
- **Community** - For inspiration and feedback

---

<div align="center">
  <p><strong>🎮 Happy Gaming with Jokominto! 🎮</strong></p>
  <p>Made with ❤️ and lots of ☕</p>
</div> 