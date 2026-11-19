// Example integration (classic loading): chiptune-music.js is a plain script
// that exposes window.ChillMusic, so no import statement is needed.
//   <script src="chiptune-music.js"></script>
//   <script src="game.js"></script>

const music = new window.ChillMusic({ bpm: 72, volume: 0.5 });

// Browsers block audio until a user gesture, so start it from a click or keypress
startButton.addEventListener('click', () => music.start());

// In your game logic
function onEat(score) {
  music.eat();                                // short in-key blip
  music.setIntensity(Math.min(score / 30, 1)); // more drums, brighter filter, busier arp
}
function onDeath()   { music.gameOver(); }    // descending sweep, muffles the music
function onRestart() { music.setIntensity(0.1); }

// Mute toggle (persists in localStorage)
window.addEventListener('keydown', e => { if (e.key === 'm') music.toggleMute(); });
