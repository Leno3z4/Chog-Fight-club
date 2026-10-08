const siteShell = document.querySelector("#site-shell");
const gameShell = document.querySelector("#game-shell");
const exitGame = document.querySelector("#exit-game");
const enterButtons = document.querySelectorAll("[data-enter-arena]");

function enterArena() {
  siteShell?.setAttribute("aria-hidden", "true");
  gameShell?.classList.add("is-open");
  gameShell?.setAttribute("aria-hidden", "false");
  window.scrollTo({ top: 0, behavior: "instant" });
}

function exitArena() {
  gameShell?.classList.remove("is-open");
  gameShell?.setAttribute("aria-hidden", "true");
  siteShell?.setAttribute("aria-hidden", "false");
}

enterButtons.forEach((button) => button.addEventListener("click", enterArena));
exitGame?.addEventListener("click", exitArena);
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && gameShell?.classList.contains("is-open")) exitArena();
});

const revealObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (entry.isIntersecting) {
      entry.target.classList.add("is-visible");
      revealObserver.unobserve(entry.target);
    }
  }
}, { threshold: 0.12 });

document.querySelectorAll(".reveal").forEach((element) => revealObserver.observe(element));

// Keep the prototype's landing page usable even if IntersectionObserver is unavailable.
if (!("IntersectionObserver" in window)) document.querySelectorAll(".reveal").forEach((element) => element.classList.add("is-visible"));
