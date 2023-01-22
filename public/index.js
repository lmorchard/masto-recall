function init() {
  const searchField = document.body.querySelector("#searchField");
  if (searchField) {
    searchField.focus();
    searchField.select();
  }

  document.body.addEventListener("click", (ev) => {
    const { className } = ev.target;
    if (className == "media-attachment") {
      const { fullsrc } = ev.target.dataset;
      const description = ev.target.getAttribute("title");

      const displayEl = document.querySelector("#media-attachment-display");
      displayEl.src = fullsrc;
      displayEl.setAttribute("alt", description);
      displayEl.setAttribute("title", description);

      const descriptionEl = document.querySelector(
        "#media-attachment-description"
      );
      descriptionEl.innerHTML = ev.target.getAttribute("title");
    }
  });
}

init();