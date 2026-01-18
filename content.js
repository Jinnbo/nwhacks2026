const overlay = document.createElement('div');
const gifPath = chrome.runtime.getURL('gifs/fnaf-gif.gif');
overlay.innerHTML = `
  <div class="overlay">
    <img src="${gifPath}" 
         alt="GIF" 
         style="width: 1000px; height: auto;">
    <button class="close-button" id="close-overlay">X</button>
  </div>
`;

const audio = new Audio(chrome.runtime.getURL('audio/five-nights-at-freddys-full-scream-sound_2.mp3'));
audio.loop = true;
audio.volume = 1.0;

let overlayDisplayed = false;

function triggerOverlay() {
    if (overlayDisplayed) return;
    overlayDisplayed = true;
    audio.play().catch(err => console.log("Audio blocked:", err));

    if (!document.body.contains(overlay)) {
        document.body.appendChild(overlay);

        // Close button
        const closeButton = overlay.querySelector("#close-overlay");
        closeButton.addEventListener("click", () => {
            audio.pause();
            audio.currentTime = 0;
            overlay.remove();
        });
    }
}

// List of interactions to listen for
const events = ["click", "keydown", "touchstart", "touchmove"];

// Attach listeners, all will fire the same function once
events.forEach(evt => {
    document.addEventListener(evt, triggerOverlay, { once: true });
});