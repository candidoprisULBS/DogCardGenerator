const STORAGE_KEY = "dogCards";

const form = document.querySelector("#dog-card-form");
const currentCard = document.querySelector("#current-card");
const historyList = document.querySelector("#history-list");
const clearHistoryButton = document.querySelector("#clear-history");
const submitButton = form.querySelector("button[type='submit']");
const formStatus = document.querySelector("#form-status");

function getSavedCards() {
  // Keep all persistence in one place so the history can be restored on reload.
  const storedCards = localStorage.getItem(STORAGE_KEY);

  if (!storedCards) {
    return [];
  }

  try {
    const cards = JSON.parse(storedCards);
    return Array.isArray(cards) ? cards : [];
  } catch (error) {
    console.error("Unable to read saved dog cards.", error);
    return [];
  }
}

function isQuotaExceededError(error) {
  return error instanceof DOMException
    && (error.name === "QuotaExceededError" || error.code === 22 || error.code === 1014);
}

function saveCards(cards, removeOldestOnQuota = true) {
  const cardsToSave = [...cards];
  let removedCount = 0;

  while (true) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cardsToSave));
      return { saved: true, removedCount };
    } catch (error) {
      if (!isQuotaExceededError(error) || !removeOldestOnQuota || cardsToSave.length <= 1) {
        console.error("Unable to save dog cards to LocalStorage.", error);
        return { saved: false, removedCount };
      }

      // Remove the oldest entries until the compact history fits the available quota.
      cardsToSave.pop();
      removedCount += 1;
    }
  }
}

async function loadImageAsDataUrl(url) {
  const imageResponse = await fetch(url);
  if (!imageResponse.ok) {
    throw new Error(`Image request failed with status ${imageResponse.status}.`);
  }

  const blob = await imageResponse.blob();

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result !== "string") {
        reject(new Error("The image could not be converted to a Data URL."));
        return;
      }

      resolve(reader.result);
    });
    reader.addEventListener("error", () => {
      reject(reader.error || new Error("The image could not be read."));
    });
    reader.readAsDataURL(blob);
  });
}

async function fetchRandomDogImage() {
  const apiResponse = await fetch("https://dog.ceo/api/breeds/image/random");
  if (!apiResponse.ok) {
    throw new Error(`Dog image API request failed with status ${apiResponse.status}.`);
  }

  const data = await apiResponse.json();
  if (data.status !== "success" || typeof data.message !== "string") {
    throw new Error("The dog image API returned an invalid response.");
  }

  return {
    imageUrl: data.message,
    imageSrc: await loadImageAsDataUrl(data.message)
  };
}

function createCardMarkup(card, showDeleteButton = false) {
  const cardElement = document.createElement("article");
  cardElement.className = "dog-card";

  if (card.imageSrc) {
    const image = document.createElement("img");
    image.src = card.imageSrc;
    image.alt = card.caption;
    image.loading = "lazy";
    cardElement.append(image);
  } else {
    // Cards saved by an older version have no frozen image and must not re-fetch a random one.
    const imagePlaceholder = document.createElement("div");
    imagePlaceholder.className = "image-placeholder";
    imagePlaceholder.textContent = "This older card has no saved image.";
    cardElement.append(imagePlaceholder);
  }

  const details = document.createElement("div");
  details.className = "card-details";

  const caption = document.createElement("p");
  caption.className = "card-caption";
  caption.textContent = card.caption;

  const meta = document.createElement("p");
  meta.className = "card-meta";
  meta.textContent = `${card.width} × ${card.height}px`;

  details.append(caption, meta);

  if (showDeleteButton) {
    const actions = document.createElement("div");
    actions.className = "card-actions";

    const deleteButton = document.createElement("button");
    deleteButton.className = "delete-button";
    deleteButton.type = "button";
    deleteButton.textContent = "Delete";
    deleteButton.setAttribute("aria-label", `Delete ${card.caption}`);
    deleteButton.addEventListener("click", () => deleteCard(card.id));

    actions.append(deleteButton);
    details.append(actions);
  }

  cardElement.append(details);
  return cardElement;
}

function renderHistory() {
  const cards = getSavedCards();
  historyList.replaceChildren();

  if (cards.length === 0) {
    currentCard.classList.add("empty-state");
    currentCard.replaceChildren(document.createTextNode("Your generated card will appear here."));
    const emptyMessage = document.createElement("p");
    emptyMessage.className = "empty-state";
    emptyMessage.textContent = "No saved cards yet. Generate your first one above.";
    historyList.append(emptyMessage);
    return;
  }

  showCurrentCard(cards[0]);
  cards.forEach((card) => {
    historyList.append(createCardMarkup(card, true));
  });
}

function showCurrentCard(card) {
  currentCard.classList.remove("empty-state");
  currentCard.replaceChildren(createCardMarkup(card));
}

function deleteCard(cardId) {
  const remainingCards = getSavedCards().filter((card) => card.id !== cardId);
  const result = saveCards(remainingCards, false);

  if (result.saved) {
    renderHistory();
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(form);
  const width = Number(formData.get("width"));
  const height = Number(formData.get("height"));
  const caption = String(formData.get("caption")).trim();

  const captionInput = form.elements.caption;
  captionInput.setCustomValidity(caption ? "" : "Please enter a caption.");

  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }
  captionInput.setCustomValidity("");

  submitButton.disabled = true;
  formStatus.classList.remove("error");
  formStatus.textContent = "Fetching your dog image...";

  try {
    const { imageUrl, imageSrc } = await fetchRandomDogImage();
    const card = {
      id: typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      width,
      height,
      caption,
      url: imageUrl,
      imageSrc,
      timestamp: new Date().toISOString()
    };

    const result = saveCards([card, ...getSavedCards()]);
    showCurrentCard(card);

    if (!result.saved) {
      formStatus.classList.add("error");
      formStatus.textContent = "Card preview created, but history storage is full. Delete an older card and try again.";
      return;
    }

    renderHistory();
    formStatus.textContent = result.removedCount > 0
      ? "Dog card saved. The oldest history item was removed to free space."
      : "Dog card saved.";
  } catch (error) {
    console.error("Unable to generate and save the dog card.", error);
    formStatus.classList.add("error");
    formStatus.textContent = "The dog image could not be loaded. Please check your connection and try again.";
  } finally {
    submitButton.disabled = false;
  }
});

clearHistoryButton.addEventListener("click", () => {
  if (getSavedCards().length === 0) {
    return;
  }

  if (window.confirm("Clear all saved dog cards?")) {
    localStorage.removeItem(STORAGE_KEY);
    renderHistory();
  }
});

renderHistory();
