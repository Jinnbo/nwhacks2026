const overlay = document.createElement('div');
overlay.innerHTML = `
  <div class="overlay">
    <img src="https://media4.giphy.com/media/v1.Y2lkPTc5MGI3NjExazYxejl1cmExZm52NXhkMjJtM2c4bDVkMm9nN3gzazQzMDZwanRpOCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/NYCjBIBGtyeFq/giphy.gif" 
         alt="GIF" 
         style="width: 1000px; height: auto;">
    <button class="close-button" id="close-overlay">X</button>
  </div>
`;

const audio = new Audio(chrome.runtime.getURL('audio/five-nights-at-freddys-full-scream-sound_2.mp3'));
audio.loop = true;
audio.volume = 1.0;

document.addEventListener("click", () => {
    audio.play().catch(err => console.log(err));
    document.body.appendChild(overlay);

    const closeButton = overlay.querySelector("#close-overlay");
    closeButton.addEventListener("click", () => {
    audio.pause();
    audio.currentTime = 0;
    overlay.remove();
});
}, { once: true });